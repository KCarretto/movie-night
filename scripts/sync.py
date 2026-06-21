#!/usr/bin/env python3
"""Build-time sync for ``movies.json``, the Movie Night recommendation DB.

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
  release year, primary language, IMDb id and an audience vote average. Requires
  ``TMDB_API_KEY`` (a v3 API key or a v4 bearer token).
* **OMDb** (https://www.omdbapi.com) — *optional*, used to enrich each title
  with a real Rotten Tomatoes percentage and IMDb /10 rating. Requires
  ``OMDB_API_KEY``. Skipped automatically when the key is absent.

Letterboxd has no public API, so the Letterboxd average is estimated from the
TMDB vote average (``vote_average / 2``, rounded to one decimal). The estimate
is clearly flagged in the output ``comment`` field.

Movies are discovered two ways: by paging through TMDB's curated lists
(``--pages``) and by importing TMDB's daily id export (``--ids-file``, the
newline-delimited ``movie_ids_MM_DD_YYYY.json`` available from
https://files.tmdb.org/p/exports/). Each movie records its ``tmdb_id`` so later
runs skip ids already downloaded (unless ``--refresh`` is given).

Usage
-----
    export TMDB_API_KEY=xxxxxxxx        # required
    export OMDB_API_KEY=yyyyyyyy        # optional, for RT + IMDb ratings
    python3 scripts/sync.py --pages 25 --output movies.json

``--pages 25`` pulls roughly 1,000 movies (TMDB returns 20 per page). TMDB caps
its lists at 500 pages, so larger values are clamped automatically. Downloads
are rate-limited (``--pause`` seconds between requests) and show a live progress
spinner. By default the script resumes from any existing ``--output`` file and
only downloads movies it doesn't already have (use ``--refresh`` to rebuild from
scratch). ``--ids-file`` defaults to today's ``movie_ids_MM_DD_YYYY.json`` and is
silently ignored when the file is absent. The script only uses the Python
standard library, so there is nothing to install.
"""

from __future__ import annotations

import argparse
import datetime
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

# TMDB caps paginated list/discover endpoints at 500 pages; asking for more
# returns an HTTP 400 ("Invalid page: Pages start at 1 and max is 500."). We
# clamp to this so e.g. ``--pages 1000`` degrades gracefully instead of erroring.
TMDB_MAX_PAGE = 500

# Discovery endpoints we page through. Combining a couple of "good movie" lists
# yields a broad, high-quality catalogue without too much obscure noise.
TMDB_LISTS = ("movie/top_rated", "movie/popular")


# ---------------------------------------------------------------------------
# Progress reporting
# ---------------------------------------------------------------------------
class Progress:
    """Tiny spinner / progress indicator so long downloads show they're alive.

    On a TTY it animates a single in-place line (spinner + count + percentage).
    When stderr is redirected (e.g. CI logs) it prints occasional standalone
    lines instead, so logs stay readable without thousands of carriage returns.
    """

    FRAMES = "|/-\\"

    def __init__(self, label: str, total: Optional[int] = None, stream=sys.stderr):
        self.label = label
        self.total = total if (total is None or total > 0) else None
        self.stream = stream
        self.count = 0
        self._frame = 0
        self._tty = bool(getattr(stream, "isatty", lambda: False)())

    def update(self, count: Optional[int] = None, suffix: str = "") -> None:
        self.count = self.count + 1 if count is None else count
        self._frame += 1
        self._render(suffix)

    def _line(self, suffix: str) -> str:
        spin = self.FRAMES[self._frame % len(self.FRAMES)]
        if self.total:
            pct = (self.count / self.total) * 100
            line = f"{spin} {self.label}: {self.count}/{self.total} ({pct:5.1f}%)"
        else:
            line = f"{spin} {self.label}: {self.count}"
        return f"{line} {suffix}".rstrip()

    def _render(self, suffix: str) -> None:
        line = self._line(suffix)
        if self._tty:
            self.stream.write("\r\033[K" + line)
            self.stream.flush()
        elif self.total and (self.count == self.total or self.count % 25 == 0):
            self.stream.write(line + "\n")
        elif not self.total and self.count % 25 == 0:
            self.stream.write(line + "\n")

    def done(self, suffix: str = "") -> None:
        line = self._line(suffix)
        if self._tty:
            self.stream.write("\r\033[K" + line + "\n")
        else:
            self.stream.write(line + "\n")
        self.stream.flush()


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

    The *detail* dict may include an ``append_to_response=credits`` payload
    under the key ``"credits"`` so that cast and director names are embedded
    without an extra API round-trip.

    Returns ``None`` for records too incomplete to be useful (e.g. no title or
    no genre), so callers can skip them.
    """
    title = (detail.get("title") or detail.get("name") or "").strip()
    genres = [g.get("name") for g in detail.get("genres", []) if g.get("name")]
    if not title or not genres:
        return None

    vote_average = detail.get("vote_average")
    movie: Dict[str, Any] = {
        "title": title,
        "year": year_from_date(detail.get("release_date")),
        "primaryGenre": genres[0],
        "genres": genres,
        # Primary spoken language as an ISO 639-1 code (e.g. "en", "fr", "ja").
        # Used by the app to flag non-English films with a country-flag badge.
        "language": (detail.get("original_language") or "").strip() or None,
        "description": (detail.get("overview") or "").strip(),
        "art": poster_url(detail.get("poster_path")),
        "ratings": {
            "letterboxd": estimate_letterboxd(vote_average),
            "rottenTomatoes": parse_rt_percentage(omdb),
            "imdb": parse_imdb_rating(omdb, vote_average),
        },
    }
    # Keep the TMDB id so future runs can skip movies already downloaded.
    tmdb_id = detail.get("id")
    if isinstance(tmdb_id, int):
        movie["tmdb_id"] = tmdb_id

    # Extract cast (top 5 by order) and director(s) from the embedded credits
    # payload — present when the detail was fetched with append_to_response=credits.
    credits = detail.get("credits") or {}
    cast_entries = credits.get("cast") or []
    crew_entries = credits.get("crew") or []
    cast = [
        str(c["name"])
        for c in cast_entries
        if c.get("name") and c.get("order", 999) < 5
    ][:5]
    directors = [
        str(c["name"])
        for c in crew_entries
        if c.get("name") and c.get("job") == "Director"
    ]
    if cast:
        movie["cast"] = cast
    if directors:
        movie["director"] = directors
    return movie


def dedupe_movies(movies: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Drop duplicate titles (case-insensitive), keeping first occurrence."""
    seen = set()
    out: List[Dict[str, Any]] = []
    for movie in movies:
        key = title_key(movie.get("title", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(movie)
    return out


def title_key(title: str) -> str:
    """Normalize a title for de-duplication / resume matching.

    Case-insensitive, trims surrounding whitespace and strips punctuation so
    e.g. "Spider-Man" and "spider man" collapse to the same key.
    """
    return "".join(ch for ch in str(title or "").lower() if ch.isalnum())


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


def fetch_omdb(
    api_key: str, imdb_id: str, max_retries: int = 3, pause: float = 0.25
) -> Optional[Dict[str, Any]]:
    if not api_key or not imdb_id:
        return None
    url = OMDB_BASE + "?" + urllib.parse.urlencode({"apikey": api_key, "i": imdb_id})
    last_error: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            time.sleep(pause)
            data = _http_get_json(url)
            return data if data.get("Response") == "True" else None
        except urllib.error.HTTPError as err:
            if err.code == 429:
                wait = int(err.headers.get("Retry-After", "1")) + 1
                time.sleep(wait)
                last_error = err
                continue
            last_error = err
            time.sleep(1 + attempt)
        except (urllib.error.URLError, ValueError) as err:
            last_error = err
            time.sleep(1 + attempt)
    print(f"\n  OMDb skip {imdb_id}: {last_error}", file=sys.stderr)
    return None


def collect_movies_to_fetch(
    client: TMDBClient, pages: int, progress: Optional[Progress] = None
) -> List[tuple]:
    """Page through the TMDB lists, returning ``(id, title)`` for each movie.

    Stops a list early if TMDB rejects the page (HTTP 400 beyond its 500-page
    cap) or returns no more results, so very large ``--pages`` values degrade
    gracefully instead of crashing.
    """
    items: List[tuple] = []
    seen = set()
    for list_path in TMDB_LISTS:
        for page in range(1, pages + 1):
            try:
                data = client.get(list_path, {"page": str(page), "language": "en-US"})
            except urllib.error.HTTPError as err:
                if err.code == 400:
                    print(
                        f"\n  {list_path}: TMDB rejected page {page} (HTTP 400); "
                        "stopping this list.",
                        file=sys.stderr,
                    )
                    break
                raise
            results = data.get("results", [])
            if not results:
                break
            for item in results:
                movie_id = item.get("id")
                if movie_id and movie_id not in seen:
                    seen.add(movie_id)
                    title = (item.get("title") or item.get("name") or "").strip()
                    items.append((movie_id, title))
            if progress:
                progress.update(suffix=f"{list_path} p{page} · {len(items)} found")
    return items


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def iter_new_movies(
    pages: int,
    tmdb_key: str,
    omdb_key: str,
    pause: float = 0.25,
    known_ids: Optional[set] = None,
    known_titles: Optional[set] = None,
    extra_ids: Optional[Iterable[int]] = None,
) -> Iterable[Dict[str, Any]]:
    """Yield newly-discovered movies one at a time (generator).

    Movies whose TMDB id or normalised title already appears in *known_ids* /
    *known_titles* are skipped so callers can resume an existing catalogue.
    De-duplication within this run is also handled inline: each yielded movie's
    id and title key are added to the sets immediately so later duplicates from
    the same run are dropped.

    Yields one fully-built movie dict per successfully downloaded entry, so
    callers can write each record to disk immediately and never hold more than
    a handful of objects in memory at once.
    """
    if pages > TMDB_MAX_PAGE:
        print(
            f"Note: TMDB caps lists at {TMDB_MAX_PAGE} pages; clamping --pages "
            f"{pages} → {TMDB_MAX_PAGE}.",
            file=sys.stderr,
        )
        pages = TMDB_MAX_PAGE

    # Work on private copies so we don't mutate the caller's sets.
    seen_ids: set = set(known_ids or ())
    seen_titles: set = set(known_titles or ())

    client = TMDBClient(tmdb_key, pause=pause)

    discover = Progress("Discovering movies", total=pages * len(TMDB_LISTS))
    candidates = collect_movies_to_fetch(client, pages, discover)
    discover.done(suffix=f"{len(candidates)} candidates")

    # Fold in any ids supplied via --ids-file (the TMDB daily export). These
    # have no title yet, so they're carried as ``(id, "")`` and de-duplicated
    # against the ids already discovered above.
    if extra_ids:
        discovered_ids = {mid for (mid, _title) in candidates}
        added = 0
        for mid in extra_ids:
            if mid not in discovered_ids:
                discovered_ids.add(mid)
                candidates.append((mid, ""))
                added += 1
        if added:
            print(f"Added {added} movie id(s) from --ids-file.", file=sys.stderr)

    # Filter out already-known entries before downloading anything.
    pending = [
        (mid, title)
        for (mid, title) in candidates
        if mid not in seen_ids and (not title or title_key(title) not in seen_titles)
    ]
    skipped = len(candidates) - len(pending)
    if skipped:
        print(f"Skipping {skipped} movie(s) already in the catalogue.", file=sys.stderr)

    progress = Progress("Downloading details", total=len(pending))
    for movie_id, _title in pending:
        progress.update()
        try:
            detail = client.get(
                f"movie/{movie_id}",
                {"language": "en-US", "append_to_response": "credits"},
            )
        except (RuntimeError, urllib.error.HTTPError) as err:
            print(f"\n  skip {movie_id}: {err}", file=sys.stderr)
            continue
        omdb = fetch_omdb(omdb_key, detail.get("imdb_id", ""), pause=pause) if omdb_key else None
        movie = build_movie(detail, omdb)
        if not movie:
            continue
        # Inline de-duplication: skip if we've already seen this title/id in
        # this run (e.g. the same film appeared in multiple TMDB list pages).
        key = title_key(movie.get("title", ""))
        if key and key in seen_titles:
            continue
        if key:
            seen_titles.add(key)
        mid = movie.get("tmdb_id")
        if isinstance(mid, int):
            seen_ids.add(mid)
        yield movie
    progress.done()


def load_existing(path: str) -> List[Dict[str, Any]]:
    """Load movies from a previously generated catalogue (for resume)."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    movies = data if isinstance(data, list) else data.get("movies", [])
    return [m for m in movies if isinstance(m, dict) and m.get("title")]


def default_ids_filename(today: Optional[datetime.date] = None) -> str:
    """The TMDB daily export filename for ``today`` (``movie_ids_MM_DD_YYYY.json``)."""
    today = today or datetime.date.today()
    return today.strftime("movie_ids_%m_%d_%Y.json")


def load_ids_file(path: str) -> Iterable[int]:
    """Yield TMDB movie ids from a daily export file one at a time.

    The TMDB export (https://files.tmdb.org/p/exports/) is *newline-delimited*
    JSON — one object per line, e.g.::

        {"adult":false,"id":3924,"original_title":"Blondie","popularity":0.48}

    Implemented as a generator so the (potentially very large) export file is
    never fully loaded into memory — each id is yielded as its line is read.

    Missing files are not an error: the generator simply yields nothing so the
    caller can continue with discovery only. Malformed lines are skipped individually.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                movie_id = obj.get("id") if isinstance(obj, dict) else None
                if isinstance(movie_id, int):
                    yield movie_id
    except OSError:
        return


def _make_comment(used_omdb: bool) -> str:
    """Build the ``comment`` string for the movies.json wrapper."""
    rt_note = (
        "rottenTomatoes is the Rotten Tomatoes Tomatometer percentage from OMDb"
        if used_omdb
        else "rottenTomatoes is null because no OMDB_API_KEY was provided"
    )
    return (
        "Auto-generated by scripts/sync.py. "
        "letterboxd is an estimate (TMDB vote average / 2, out of 5); "
        f"{rt_note}; imdb is out of 10. "
        "language is the primary (original) language ISO 639-1 code. "
        "art is a TMDB poster URL with an in-app fallback if it fails to load."
    )


def wrap_output(movies: List[Dict[str, Any]], used_omdb: bool) -> Dict[str, Any]:
    return {"comment": _make_comment(used_omdb), "movies": movies}


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync movies.json for Movie Night.")
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
    parser.add_argument(
        "--ids-file",
        default=default_ids_filename(),
        help="TMDB daily export of movie ids (newline-delimited JSON) to import. "
        "Default: movie_ids_MM_DD_YYYY.json for today. Missing files are ignored.",
    )
    parser.add_argument(
        "--pause",
        type=float,
        default=0.25,
        help="Seconds to wait between TMDB requests (rate limit). Default: 0.25.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Re-download everything instead of resuming from the existing "
        "--output file (which is skipped by default).",
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

    if args.pause < 0:
        print("ERROR: --pause must be >= 0.", file=sys.stderr)
        return 2

    existing = [] if args.refresh else load_existing(args.output)
    if existing:
        print(f"Resuming from {len(existing)} movie(s) in {args.output}.", file=sys.stderr)

    # Build resume sets from existing movies so iter_new_movies can skip them.
    # We derive them here rather than inside the generator so the generator
    # doesn't need to hold the full existing list.
    known_ids: set = {
        m.get("tmdb_id") for m in existing if isinstance(m.get("tmdb_id"), int)
    }
    known_titles: set = {
        title_key(m.get("title", "")) for m in existing if m.get("title")
    }

    if os.path.isfile(args.ids_file):
        print(f"Importing movie ids from {args.ids_file}.", file=sys.stderr)
        ids: Optional[Iterable[int]] = load_ids_file(args.ids_file)
    else:
        print(f"No ids imported from {args.ids_file} (missing or empty).", file=sys.stderr)
        ids = None

    new_movies = iter_new_movies(
        args.pages, tmdb_key, omdb_key, args.pause, known_ids, known_titles, ids
    )

    # Write the output incrementally so we never hold all movies in memory at
    # once.  We build the JSON manually (header + per-movie lines + footer)
    # rather than calling json.dump on the whole structure.
    #
    # Layout:
    #   {
    #     "comment": "...",
    #     "movies": [
    #       {...},
    #       ...
    #     ]
    #   }
    comment = _make_comment(bool(omdb_key))
    tmp_path = args.output + ".tmp"
    total = 0
    try:
        with open(tmp_path, "w", encoding="utf-8") as handle:
            handle.write("{\n  ")
            handle.write('"comment": ')
            handle.write(json.dumps(comment, ensure_ascii=False))
            handle.write(',\n  "movies": [')

            first = True

            # Stream existing movies to disk first, then release the list so
            # memory occupied by those objects can be reclaimed before we start
            # the download phase.
            for movie in existing:
                handle.write((",\n" if not first else "\n") + "    ")
                handle.write(json.dumps(movie, ensure_ascii=False))
                first = False
                total += 1
            del existing

            # Stream each newly downloaded movie directly to disk — only one
            # object is in memory at a time.
            for movie in new_movies:
                handle.write((",\n" if not first else "\n") + "    ")
                handle.write(json.dumps(movie, ensure_ascii=False))
                first = False
                total += 1

            handle.write("\n  ]\n}\n")

        os.replace(tmp_path, args.output)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    print(f"Wrote {total} movies to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
