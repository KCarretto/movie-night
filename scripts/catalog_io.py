#!/usr/bin/env python3
"""Shared Protobuf <-> dict helpers for the Movie Night build pipeline.

The catalogue is stored on disk as a compact Protobuf binary (``movies.pbf``)
described by ``scripts/catalog.proto``. Both build steps — ``sync.py`` (which
downloads the catalogue) and ``generate_embeddings.py`` (which appends an
embedding pointer to each record) — read and write that same binary file.

To keep the rest of each script readable we work with a plain ``dict``
representation internally (the same shape the old ``movies.json`` used) and only
translate to/from Protobuf messages at the disk boundary. This module owns:

* the string <-> enum maps for :class:`LanguageCode` and :class:`Genre`;
* the rating scaling (floats <-> 0-100 integer varints);
* :func:`load_catalog` / :func:`save_catalog` for whole-file round-trips.

The compiled bindings (``catalog_pb2``) are generated at build time from
``catalog.proto`` with ``protoc`` (or ``python -m grpc_tools.protoc``); see the
sync workflow. They are intentionally not committed.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import catalog_pb2  # generated from catalog.proto at build time

# ---------------------------------------------------------------------------
# Enum maps
# ---------------------------------------------------------------------------
# Primary (original) language ISO 639-1 code -> LanguageCode enum. Anything not
# listed falls back to LANG_OTHER so the schema stays forward compatible.
LANGUAGE_TO_ENUM = {
    "en": catalog_pb2.LANG_EN,
    "fr": catalog_pb2.LANG_FR,
    "es": catalog_pb2.LANG_ES,
    "de": catalog_pb2.LANG_DE,
    "it": catalog_pb2.LANG_IT,
    "pt": catalog_pb2.LANG_PT,
    "ru": catalog_pb2.LANG_RU,
    "ja": catalog_pb2.LANG_JA,
    "ko": catalog_pb2.LANG_KO,
    "zh": catalog_pb2.LANG_ZH,
    "cn": catalog_pb2.LANG_ZH,  # TMDB uses both "cn" and "zh" for Chinese.
    "hi": catalog_pb2.LANG_HI,
}
ENUM_TO_LANGUAGE = {
    catalog_pb2.LANG_EN: "en",
    catalog_pb2.LANG_FR: "fr",
    catalog_pb2.LANG_ES: "es",
    catalog_pb2.LANG_DE: "de",
    catalog_pb2.LANG_IT: "it",
    catalog_pb2.LANG_PT: "pt",
    catalog_pb2.LANG_RU: "ru",
    catalog_pb2.LANG_JA: "ja",
    catalog_pb2.LANG_KO: "ko",
    catalog_pb2.LANG_ZH: "zh",
    catalog_pb2.LANG_HI: "hi",
}

# Canonical TMDB genre name (lower-cased) -> Genre enum. Unmapped categories
# fall back to GENRE_UNKNOWN so future TMDB additions degrade gracefully.
GENRE_NAME_TO_ENUM = {
    "action": catalog_pb2.GENRE_ACTION,
    "adventure": catalog_pb2.GENRE_ADVENTURE,
    "animation": catalog_pb2.GENRE_ANIMATION,
    "comedy": catalog_pb2.GENRE_COMEDY,
    "crime": catalog_pb2.GENRE_CRIME,
    "documentary": catalog_pb2.GENRE_DOCUMENTARY,
    "drama": catalog_pb2.GENRE_DRAMA,
    "family": catalog_pb2.GENRE_FAMILY,
    "fantasy": catalog_pb2.GENRE_FANTASY,
    "history": catalog_pb2.GENRE_HISTORY,
    "horror": catalog_pb2.GENRE_HORROR,
    "music": catalog_pb2.GENRE_MUSIC,
    "mystery": catalog_pb2.GENRE_MYSTERY,
    "romance": catalog_pb2.GENRE_ROMANCE,
    "science fiction": catalog_pb2.GENRE_SCIENCE_FICTION,
    "tv movie": catalog_pb2.GENRE_TV_MOVIE,
    "thriller": catalog_pb2.GENRE_THRILLER,
    "war": catalog_pb2.GENRE_WAR,
    "western": catalog_pb2.GENRE_WESTERN,
}
ENUM_TO_GENRE_NAME = {
    catalog_pb2.GENRE_ACTION: "Action",
    catalog_pb2.GENRE_ADVENTURE: "Adventure",
    catalog_pb2.GENRE_ANIMATION: "Animation",
    catalog_pb2.GENRE_COMEDY: "Comedy",
    catalog_pb2.GENRE_CRIME: "Crime",
    catalog_pb2.GENRE_DOCUMENTARY: "Documentary",
    catalog_pb2.GENRE_DRAMA: "Drama",
    catalog_pb2.GENRE_FAMILY: "Family",
    catalog_pb2.GENRE_FANTASY: "Fantasy",
    catalog_pb2.GENRE_HISTORY: "History",
    catalog_pb2.GENRE_HORROR: "Horror",
    catalog_pb2.GENRE_MUSIC: "Music",
    catalog_pb2.GENRE_MYSTERY: "Mystery",
    catalog_pb2.GENRE_ROMANCE: "Romance",
    catalog_pb2.GENRE_SCIENCE_FICTION: "Science Fiction",
    catalog_pb2.GENRE_TV_MOVIE: "TV Movie",
    catalog_pb2.GENRE_THRILLER: "Thriller",
    catalog_pb2.GENRE_WAR: "War",
    catalog_pb2.GENRE_WESTERN: "Western",
}


def language_to_enum(code: Optional[str]) -> int:
    if not code:
        return catalog_pb2.LANG_UNSPECIFIED
    return LANGUAGE_TO_ENUM.get(str(code).strip().lower(), catalog_pb2.LANG_OTHER)


def genre_to_enum(name: Optional[str]) -> int:
    if not name:
        return catalog_pb2.GENRE_UNSPECIFIED
    return GENRE_NAME_TO_ENUM.get(str(name).strip().lower(), catalog_pb2.GENRE_UNKNOWN)


# ---------------------------------------------------------------------------
# Rating scaling (float <-> 0-100 integer varint)
# ---------------------------------------------------------------------------
# IMDb is out of 10 and Letterboxd out of 5; both are scaled by 10 so one
# decimal of precision survives as a small varint (0 means "no rating").
# Rotten Tomatoes is already an integer percentage (0-100).
def _scale_rating(value: Any, factor: float) -> int:
    if value is None:
        return 0
    try:
        return max(0, int(round(float(value) * factor)))
    except (TypeError, ValueError):
        return 0


def _unscale_rating(value: int, factor: float) -> Optional[float]:
    if not value:
        return None
    return round(value / factor, 1)


# ---------------------------------------------------------------------------
# dict <-> protobuf Movie
# ---------------------------------------------------------------------------
def movie_dict_to_proto(movie: Dict[str, Any], msg: "catalog_pb2.Movie") -> None:
    """Populate a ``catalog_pb2.Movie`` from our internal dict representation."""
    tmdb_id = movie.get("tmdb_id")
    if isinstance(tmdb_id, int) and tmdb_id > 0:
        msg.id = tmdb_id
    year = movie.get("year")
    if isinstance(year, int) and year > 0:
        msg.year = year
    msg.language = language_to_enum(movie.get("language"))

    ratings = movie.get("ratings") or {}
    msg.letterboxd_rating = _scale_rating(ratings.get("letterboxd"), 10.0)
    msg.rotten_tomatoes_rating = _scale_rating(ratings.get("rottenTomatoes"), 1.0)
    msg.imdb_rating = _scale_rating(ratings.get("imdb"), 10.0)

    msg.primary_genre = genre_to_enum(movie.get("primaryGenre"))
    for genre in movie.get("genres") or []:
        msg.genres.append(genre_to_enum(genre))

    msg.title = str(movie.get("title") or "")
    msg.description = str(movie.get("description") or "")
    msg.art_path = str(movie.get("art") or "")

    v_idx = movie.get("v_idx")
    if isinstance(v_idx, int) and v_idx >= 0:
        msg.v_idx = v_idx

    for director in movie.get("director") or []:
        msg.director.append(str(director))
    for member in movie.get("cast") or []:
        msg.cast.append(str(member))


def movie_proto_to_dict(msg: "catalog_pb2.Movie") -> Dict[str, Any]:
    """Inflate a ``catalog_pb2.Movie`` back to our internal dict representation."""
    movie: Dict[str, Any] = {
        "title": msg.title,
        "primaryGenre": ENUM_TO_GENRE_NAME.get(msg.primary_genre),
        "genres": [ENUM_TO_GENRE_NAME.get(g) for g in msg.genres if g in ENUM_TO_GENRE_NAME],
        "language": ENUM_TO_LANGUAGE.get(msg.language),
        "description": msg.description,
        "art": msg.art_path,
        "ratings": {
            "letterboxd": _unscale_rating(msg.letterboxd_rating, 10.0),
            "rottenTomatoes": (msg.rotten_tomatoes_rating or None),
            "imdb": _unscale_rating(msg.imdb_rating, 10.0),
        },
    }
    if msg.year:
        movie["year"] = msg.year
    if msg.id:
        movie["tmdb_id"] = msg.id
    if msg.v_idx:
        movie["v_idx"] = msg.v_idx
    if msg.cast:
        movie["cast"] = list(msg.cast)
    if msg.director:
        movie["director"] = list(msg.director)
    return movie


# ---------------------------------------------------------------------------
# Whole-file round-trips
# ---------------------------------------------------------------------------
def load_catalog(path: str) -> List[Dict[str, Any]]:
    """Read ``movies.pbf`` and return a list of internal movie dicts.

    A missing or unreadable file yields an empty list so callers can resume from
    scratch without special-casing first runs.
    """
    if not os.path.exists(path):
        return []
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError:
        return []
    catalog = catalog_pb2.MovieCatalog()
    catalog.ParseFromString(data)
    return [movie_proto_to_dict(m) for m in catalog.movies]


def load_catalog_proto(path: str) -> "catalog_pb2.MovieCatalog":
    """Read ``movies.pbf`` straight into a ``MovieCatalog`` message."""
    catalog = catalog_pb2.MovieCatalog()
    if os.path.exists(path):
        with open(path, "rb") as handle:
            catalog.ParseFromString(handle.read())
    return catalog


def save_catalog(path: str, movies: List[Dict[str, Any]]) -> None:
    """Serialize internal movie dicts into a dense ``movies.pbf`` binary."""
    catalog = catalog_pb2.MovieCatalog()
    for movie in movies:
        movie_dict_to_proto(movie, catalog.movies.add())
    save_catalog_proto(path, catalog)


def save_catalog_proto(path: str, catalog: "catalog_pb2.MovieCatalog") -> None:
    """Atomically write a ``MovieCatalog`` message to ``path``."""
    tmp_path = path + ".tmp"
    with open(tmp_path, "wb") as handle:
        handle.write(catalog.SerializeToString())
    os.replace(tmp_path, path)
