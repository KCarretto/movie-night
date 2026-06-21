#!/usr/bin/env python3
"""Build-time embedding generator for the Movie Night recommendation engine.

Why a build step instead of a runtime API?
------------------------------------------
Movie Night is a *serverless* static page hosted on GitHub Pages. There is no
backend to run a model or hold a secret, so the recommendation vectors are
computed **once at build time** by this script and committed alongside
``movies.json``. The browser then builds each user's taste vector locally and
ranks candidates by cosine similarity — no key, no server, fully offline at
runtime.

Why a *separate* ``embeddings.json``?
-------------------------------------
The raw vectors are large. Appending them inline to ``movies.json`` would bloat
the catalogue the UI must download before it can render, and risks bumping into
GitHub Pages' 100 MB file limit. Instead we keep ``movies.json`` lean and write
the vectors to a **separate ``embeddings.json``** that the client lazy-loads in
the background after the UI is already interactive. Two further tricks keep the
file small:

* **Reduced dimensionality** — the local model
  (``sentence-transformers/all-MiniLM-L6-v2``) emits 384-dimensional vectors,
  ~75% smaller than 1536-dimensional models while keeping strong semantic
  awareness.
* **Rounded precision** — every float is rounded to 4 decimal places, which
  dramatically shrinks the JSON text with negligible impact on similarity.

What it does
------------
For every movie that does not already have an entry in ``embeddings.json``, this
script combines the movie's ``title``, ``description``, ``primaryGenre``,
``genres``, ``director`` and ``cast`` into one text string, embeds it into a
fixed-length vector, rounds each component to 4 decimals and stores it under the
movie's stable key (its ``id`` when present, otherwise a normalised ``title``).
Movies already present in ``embeddings.json`` are skipped so repeated runs only
pay for the new titles added by the sync step.

``embeddings.json`` is a **flat dictionary**::

    { "<movie-key>": [0.0123, -0.0456, ...], ... }

Backends
--------
* **Local (default)** — a lightweight Hugging Face sentence-transformers model
  (``sentence-transformers/all-MiniLM-L6-v2``, 384 dims). Runs entirely offline
  on CPU, no API key required.
* **OpenAI** — pass ``--backend openai`` (or set ``EMBED_BACKEND=openai``) to use
  OpenAI's ``text-embedding-3-small``. Requires ``OPENAI_API_KEY``.

Usage
-----
    pip install sentence-transformers          # local backend (default)
    python3 scripts/generate_embeddings.py --movies movies.json --embeddings embeddings.json

    # or, using OpenAI:
    pip install openai
    export OPENAI_API_KEY=sk-...
    python3 scripts/generate_embeddings.py --backend openai
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Sequence

# Default models per backend.
LOCAL_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
OPENAI_MODEL = "text-embedding-3-small"

# Fields combined (in order) into the text we embed for each movie.
EMBED_FIELDS = ("title", "description", "primaryGenre", "genres", "director", "cast")

# Decimal places kept per vector component (keeps embeddings.json small).
ROUND_DECIMALS = 4

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def movie_key(movie: Dict[str, Any]) -> str:
    """Stable lookup key for a movie.

    Prefers an explicit ``id`` when present; otherwise falls back to a
    normalised title (lower-cased, stripped to alphanumerics). This mirrors the
    ``dbKey`` normalisation the browser uses to look vectors back up.
    """
    mid = movie.get("id")
    if mid not in (None, ""):
        return str(mid)
    title = str(movie.get("title", "")).lower()
    return _NON_ALNUM.sub("", title)


def _as_text(value: Any) -> str:
    """Flatten a movie field (string, list, or None) into a plain string."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(_as_text(v) for v in value if v not in (None, ""))
    return str(value).strip()


def movie_text(movie: Dict[str, Any]) -> str:
    """Combine the relevant movie fields into a single text string."""
    parts = [_as_text(movie.get(field)) for field in EMBED_FIELDS]
    return " | ".join(part for part in parts if part)


def round_vector(vector: Sequence[float]) -> List[float]:
    """Round every component to ``ROUND_DECIMALS`` decimal places."""
    return [round(float(x), ROUND_DECIMALS) for x in vector]


class LocalBackend:
    """sentence-transformers embedding backend (offline, no key)."""

    def __init__(self, model_name: str = LOCAL_MODEL) -> None:
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name)

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        vectors = self._model.encode(
            list(texts), batch_size=64, show_progress_bar=False, convert_to_numpy=True
        )
        return [[float(x) for x in vec] for vec in vectors]


class OpenAIBackend:
    """OpenAI embedding backend. Requires OPENAI_API_KEY."""

    def __init__(self, model_name: str = OPENAI_MODEL) -> None:
        from openai import OpenAI

        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is not set but --backend openai was requested.")
        self._client = OpenAI()
        self._model = model_name

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        resp = self._client.embeddings.create(model=self._model, input=list(texts))
        # Preserve request order (the API echoes an index per item).
        ordered = sorted(resp.data, key=lambda d: d.index)
        return [list(d.embedding) for d in ordered]


def make_backend(name: str):
    if name == "openai":
        return OpenAIBackend()
    if name == "local":
        return LocalBackend()
    raise ValueError(f"Unknown backend: {name!r}")


def load_movies(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, list):
        movies = data
    elif isinstance(data, dict) and isinstance(data.get("movies"), list):
        movies = data["movies"]
    else:
        raise ValueError(f"{path} does not look like a movies DB (expected a 'movies' list).")
    return [m for m in movies if isinstance(m, dict)]


def load_embeddings(path: str) -> Dict[str, List[float]]:
    """Load the existing embeddings map, or an empty dict if absent/empty."""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, list)}


def save_embeddings(path: str, embeddings: Dict[str, List[float]]) -> None:
    """Write the flat ``{key: vector}`` map atomically, compactly."""
    tmp_path = path + ".tmp"
    items = list(embeddings.items())
    with open(tmp_path, "w", encoding="utf-8") as handle:
        handle.write("{\n")
        for index, (key, vector) in enumerate(items):
            # Compact vector encoding (no spaces) keeps the file lean.
            handle.write("  " + json.dumps(str(key), ensure_ascii=False) + ": "
                         + json.dumps(vector, ensure_ascii=False, separators=(",", ":")))
            handle.write(",\n" if index < len(items) - 1 else "\n")
        handle.write("}\n")
    os.replace(tmp_path, path)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--movies", "--input", dest="movies_path", default="movies.json",
                        help="Path to the movies DB to read (default: movies.json).")
    parser.add_argument("--embeddings", "--output", dest="embeddings_path", default="embeddings.json",
                        help="Path to the embeddings map to read and update (default: embeddings.json).")
    parser.add_argument("--backend", choices=("local", "openai"),
                        default=os.environ.get("EMBED_BACKEND", "local"),
                        help="Embedding backend to use (default: local sentence-transformers).")
    parser.add_argument("--batch-size", type=int, default=256,
                        help="How many movie texts to embed per backend call (default: 256).")
    parser.add_argument("--limit", type=int, default=0,
                        help="Optional cap on the number of movies to embed this run (0 = no limit).")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)

    movies = load_movies(args.movies_path)
    embeddings = load_embeddings(args.embeddings_path)

    # Movies missing an embedding (skip ones we've already processed). De-dupe
    # by key so two movies that normalise to the same key are only embedded once.
    pending: List[Dict[str, Any]] = []
    pending_keys = set()
    for movie in movies:
        key = movie_key(movie)
        if not key or key in embeddings or key in pending_keys:
            continue
        pending.append(movie)
        pending_keys.add(key)

    if args.limit > 0:
        pending = pending[: args.limit]

    if not pending:
        # Still ensure the file exists so the client's lazy fetch succeeds.
        if not os.path.exists(args.embeddings_path):
            save_embeddings(args.embeddings_path, embeddings)
        print("All movies already have embeddings — nothing to do.")
        return 0

    print(f"Embedding {len(pending)} of {len(movies)} movies via '{args.backend}' backend...")
    backend = make_backend(args.backend)

    done = 0
    for start in range(0, len(pending), args.batch_size):
        chunk = pending[start : start + args.batch_size]
        texts = [movie_text(m) for m in chunk]
        vectors = backend.embed(texts)
        if len(vectors) != len(chunk):
            raise RuntimeError(
                f"Backend returned {len(vectors)} vectors for {len(chunk)} inputs."
            )
        for movie, vector in zip(chunk, vectors):
            embeddings[movie_key(movie)] = round_vector(vector)
        done += len(chunk)
        print(f"  embedded {done}/{len(pending)}", flush=True)

    save_embeddings(args.embeddings_path, embeddings)
    print(f"Wrote {args.embeddings_path} with {done} new embeddings ({len(embeddings)} total).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
