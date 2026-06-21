#!/usr/bin/env python3
"""Build-time generator for ``movies.json``, the Movie Night recommendation DB.

Why a build step instead of a runtime API?
------------------------------------------
Movie Night is a *serverless* static page hosted on GitHub Pages. There is no
backend to proxy API calls and no safe place to keep a secret, so calling a
movie API (TMDB/OMDb) directly from the browser would either leak an API key or
fail CORS/rate limits. Instead we fetch the catalogue **once at build time**
with this script and commit the resulting ``movies.json`` so the runtime app
stays key-free and serverless.

Data sources
------------
* **TMDB** (https://www.themoviedb.org) — catalogue, posters, genres, overview,
  release year, IMDb id and an audience vote average. Requires ``TMDB_API_KEY``
  (a v3 API key or a v4 bearer token).
* **OMDb** (https://www.omdbapi.com) — *optional*, used to enrich each title
  with a real Rotten Tomatoes percentage and IMDb /10 rating. Requires
  ``OMDB_API_KEY``. Skipped automatically when the key is absent.

Letterboxd has no public API, so the Letterboxd average is estimated from the
TMDB vote average (``vote_average / 2``, rounded to one decimal). The estimate
is clearly flagged in the output ``comment`` field.

Usage
-----
    export TMDB_API_KEY=xxxxxxxx        # required
    export OMDB_API_KEY=yyyyyyyy        # optional, for RT + IMDb ratings
    python3 scripts/generate_movies.py --pages 25 --output movies.json

``--pages 25`` pulls roughly 1,000 movies (TMDB returns 20 per page). The
script only uses the Python standard library, so there is nothing to install.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342"
OMDB_BASE = "https://www.omdbapi.com/"

# Discovery endpoints we page through. Combining a couple of "good movie" lists
# yields a broad, high-quality catalogue without too much obscure noise.
TMDB_LISTS = ("movie/top_rated", "movie/popular")


# ---------------------------------------------------------------------------
# Pure helpers (no network) — these are unit-tested offline.
# ---------------------------------------------------------------------------
def poster_url(poster_path: Optional[str]) -> str:
    """Build an absolute TMDB poster URL (empty string when none is set)."""
    if not poster_path:
        return ""
    return TMDB_IMAGE_BASE + poster_path


def year_from_date(release_date: Optional[str]) -> Optional[int]:
    """Extract the integer year from a ``YYYY-MM-DD`` TMDB release date."""
    if not release_date:
        return None
    try:
        return int(str(release_date)[:4])
    except ValueError:
        return None


def parse_rt_percentage(omdb: Optional[Dict[str, Any]]) -> Optional[int]:
    """Pull the Rotten Tomatoes Tomatometer (an int 0-100) from an OMDb record."""
    if not omdb:
        return None
    for rating in omdb.get("Ratings", []) or []:
        if rating.get("Source") == "Rotten Tomatoes":
            value = str(rating.get("Value", "")).rstrip("%")
            try:
                return int(round(float(value)))
            except ValueError:
                return None
    return None


def parse_imdb_rating(
    omdb: Optional[Dict[str, Any]], tmdb_vote_average: Optional[float]
) -> Optional[float]:
    """Prefer the real OMDb IMDb rating, else fall back to the TMDB average."""
    if omdb:
        raw = omdb.get("imdbRating")
        if raw and raw != "N/A":
            try:
                return round(float(raw), 1)
            except ValueError:
                pass
    if tmdb_vote_average is not None:
        try:
            return round(float(tmdb_vote_average), 1)
        except (TypeError, ValueError):
            return None
    return None


def estimate_letterboxd(tmdb_vote_average: Optional[float]) -> Optional[float]:
    """Estimate a Letterboxd /5 average from a TMDB /10 vote average."""
    if tmdb_vote_average is None:
        return None
    try:
        return round(float(tmdb_vote_average) / 2.0, 1)
    except (TypeError, ValueError):
        return None


def build_movie(
    detail: Dict[str, Any], omdb: Optional[Dict[str, Any]] = None
) -> Optional[Dict[str, Any]]:
    """Map a TMDB *details* payload (+ optional OMDb) to our schema.

    Returns ``None`` for records too incomplete to be useful (e.g. no title or
    no genre), so callers can skip them.
    """
    title = (detail.get("title") or detail.get("name") or "").strip()
    genres = [g.get("name") for g in detail.get("genres", []) if g.get("name")]
    if not title or not genres:
        return None

    vote_average = detail.get("vote_average")
    return {
        "title": title,
        "year": year_from_date(detail.get("release_date")),
        "primaryGenre": genres[0],
        "genres": genres,
        "description": (detail.get("overview") or "").strip(),
        "art": poster_url(detail.get("poster_path")),
        "ratings": {
            "letterboxd": estimate_letterboxd(vote_average),
            "rottenTomatoes": parse_rt_percentage(omdb),
            "imdb": parse_imdb_rating(omdb, vote_average),
        },
    }


def dedupe_movies(movies: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop duplicate titles (case-insensitive), keeping first occurrence."""
    seen = set()
    out: List[Dict[str, Any]] = []
    for movie in movies:
        key = movie["title"].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(movie)
    return out


# ---------------------------------------------------------------------------
# Network layer
# ---------------------------------------------------------------------------
def _http_get_json(url: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


class TMDBClient:
    """Thin TMDB client supporting both v3 api_key and v4 bearer auth."""

    def __init__(self, api_key: str, max_retries: int = 3, pause: float = 0.25):
        self.api_key = api_key
        self.max_retries = max_retries
        self.pause = pause
        # v4 bearer tokens are JWTs (three base64 segments, "eyJ" prefix).
        self.use_bearer = api_key.startswith("eyJ")

    def _url(self, path: str, params: Optional[Dict[str, str]] = None) -> str:
        params = dict(params or {})
        if not self.use_bearer:
            params["api_key"] = self.api_key
        return f"{TMDB_BASE}/{path}?{urllib.parse.urlencode(params)}"

    def _headers(self) -> Dict[str, str]:
        if self.use_bearer:
            return {"Authorization": "Bearer " + self.api_key}
        return {}

    def get(self, path: str, params: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        url = self._url(path, params)
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries):
            try:
                time.sleep(self.pause)
                return _http_get_json(url, self._headers())
            except urllib.error.HTTPError as err:
                # 429 = rate limited; honour Retry-After then retry.
                if err.code == 429:
                    wait = int(err.headers.get("Retry-After", "1")) + 1
                    time.sleep(wait)
                    last_error = err
                    continue
                raise
            except urllib.error.URLError as err:
                last_error = err
                time.sleep(1 + attempt)
        raise RuntimeError(f"TMDB request failed: {url}: {last_error}")


def fetch_omdb(api_key: str, imdb_id: str) -> Optional[Dict[str, Any]]:
    if not api_key or not imdb_id:
        return None
    url = OMDB_BASE + "?" + urllib.parse.urlencode({"apikey": api_key, "i": imdb_id})
    try:
        data = _http_get_json(url)
    except (urllib.error.URLError, ValueError):
        return None
    return data if data.get("Response") == "True" else None


def collect_movie_ids(client: TMDBClient, pages: int) -> List[int]:
    ids: List[int] = []
    seen = set()
    for list_path in TMDB_LISTS:
        for page in range(1, pages + 1):
            data = client.get(list_path, {"page": str(page), "language": "en-US"})
            results = data.get("results", [])
            if not results:
                break
            for item in results:
                movie_id = item.get("id")
                if movie_id and movie_id not in seen:
                    seen.add(movie_id)
                    ids.append(movie_id)
    return ids


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def generate(pages: int, tmdb_key: str, omdb_key: str) -> Dict[str, Any]:
    client = TMDBClient(tmdb_key)
    ids = collect_movie_ids(client, pages)
    print(f"Discovered {len(ids)} candidate movies from TMDB.", file=sys.stderr)

    movies: List[Dict[str, Any]] = []
    for index, movie_id in enumerate(ids, start=1):
        try:
            detail = client.get(f"movie/{movie_id}", {"language": "en-US"})
        except RuntimeError as err:
            print(f"  skip {movie_id}: {err}", file=sys.stderr)
            continue
        omdb = fetch_omdb(omdb_key, detail.get("imdb_id", "")) if omdb_key else None
        movie = build_movie(detail, omdb)
        if movie:
            movies.append(movie)
        if index % 50 == 0:
            print(f"  processed {index}/{len(ids)}…", file=sys.stderr)

    movies = dedupe_movies(movies)
    movies.sort(key=lambda m: (m["ratings"].get("imdb") or 0), reverse=True)
    return wrap_output(movies, bool(omdb_key))


def wrap_output(movies: List[Dict[str, Any]], used_omdb: bool) -> Dict[str, Any]:
    rt_note = (
        "rottenTomatoes is the Rotten Tomatoes Tomatometer percentage from OMDb"
        if used_omdb
        else "rottenTomatoes is null because no OMDB_API_KEY was provided"
    )
    return {
        "comment": (
            "Auto-generated by scripts/generate_movies.py. "
            "letterboxd is an estimate (TMDB vote average / 2, out of 5); "
            f"{rt_note}; imdb is out of 10. "
            "art is a TMDB poster URL with an in-app fallback if it fails to load."
        ),
        "movies": movies,
    }


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate movies.json for Movie Night.")
    parser.add_argument(
        "--pages",
        type=int,
        default=25,
        help="TMDB pages to pull per list (20 movies/page). Default: 25.",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(os.path.dirname(os.path.dirname(__file__)), "movies.json"),
        help="Path to write the JSON catalogue. Default: <repo>/movies.json.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    tmdb_key = os.environ.get("TMDB_API_KEY", "").strip()
    omdb_key = os.environ.get("OMDB_API_KEY", "").strip()
    if not tmdb_key:
        print(
            "ERROR: TMDB_API_KEY is required. Get a free key at "
            "https://www.themoviedb.org/settings/api",
            file=sys.stderr,
        )
        return 2
    if not omdb_key:
        print(
            "WARNING: OMDB_API_KEY not set — Rotten Tomatoes/IMDb ratings will be "
            "estimated from TMDB only.",
            file=sys.stderr,
        )

    payload = generate(args.pages, tmdb_key, omdb_key)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"Wrote {len(payload['movies'])} movies to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
