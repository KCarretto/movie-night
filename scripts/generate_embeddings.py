#!/usr/bin/env python3
"""Build-time embedding generator for ``movies.json``.

Why a build step instead of a runtime API?
------------------------------------------
Movie Night is a *serverless* static page hosted on GitHub Pages. There is no
backend to run a model or hold a secret, so the recommendation vectors are
computed **once at build time** by this script and committed into
``movies.json``. The browser then builds the user's taste vector locally and
ranks candidates by cosine similarity — no key, no server, fully offline at
runtime.

What it does
------------
For every movie that does not already carry an ``embedding`` array, this script
combines the movie's ``title``, ``description``, ``primaryGenre``, ``genres``,
``director`` and ``cast`` into one text string, embeds it into a fixed-length
vector and stores that vector under the movie's ``embedding`` key. Movies that
already have an ``embedding`` are skipped so repeated runs only pay for the new
titles added by the sync step.

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
    python3 scripts/generate_embeddings.py --input movies.json

    # or, using OpenAI:
    pip install openai
    export OPENAI_API_KEY=sk-...
    python3 scripts/generate_embeddings.py --backend openai
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional, Sequence

# Default models per backend.
LOCAL_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
OPENAI_MODEL = "text-embedding-3-small"

# Fields combined (in order) into the text we embed for each movie.
EMBED_FIELDS = ("title", "description", "primaryGenre", "genres", "director", "cast")


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


def load_db(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return {"movies": data}
    if not isinstance(data, dict) or not isinstance(data.get("movies"), list):
        raise ValueError(f"{path} does not look like a movies DB (expected a 'movies' list).")
    return data


def save_db(path: str, data: Dict[str, Any]) -> None:
    """Write the DB back, mirroring the streamed layout used by sync.py."""
    comment = data.get("comment")
    movies = data.get("movies", [])
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        handle.write("{\n  ")
        if comment is not None:
            handle.write('"comment": ')
            handle.write(json.dumps(comment, ensure_ascii=False))
            handle.write(',\n  "movies": [')
        else:
            handle.write('"movies": [')
        first = True
        for movie in movies:
            handle.write(("," if not first else "") + "\n    ")
            handle.write(json.dumps(movie, ensure_ascii=False))
            first = False
        handle.write("\n  ]\n}\n")
    os.replace(tmp_path, path)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", "--output", dest="path", default="movies.json",
                        help="Path to the movies DB to read and update (default: movies.json).")
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

    data = load_db(args.path)
    movies = data["movies"]

    # Movies missing an embedding (skip ones we've already processed).
    pending = [m for m in movies if isinstance(m, dict) and not m.get("embedding")]
    if args.limit > 0:
        pending = pending[: args.limit]

    if not pending:
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
            movie["embedding"] = vector
        done += len(chunk)
        print(f"  embedded {done}/{len(pending)}", flush=True)

    save_db(args.path, data)
    print(f"Wrote {args.path} with {done} new embeddings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
