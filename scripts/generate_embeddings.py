#!/usr/bin/env python3
"""Build-time embedding generator for the Movie Night recommendation engine.

Why a build step instead of a runtime API?
------------------------------------------
Movie Night is a *serverless* static page hosted on GitHub Pages. There is no
backend to run a model or hold a secret, so the recommendation vectors are
computed **once at build time** by this script and committed alongside
``movies.pbf``. The browser then builds each user's taste vector locally and
ranks candidates by cosine similarity — no key, no server, fully offline at
runtime.

Why a *separate* ``embeddings.bin``?
------------------------------------
The raw vectors are large. Appending them inline to ``movies.pbf`` would bloat
the catalogue the UI must download before it can render, and risks bumping into
GitHub Pages' 100 MB file limit. Instead we keep ``movies.pbf`` lean and write
the vectors to a **separate ``embeddings.bin``** that the client lazy-loads in
the background after the UI is already interactive.

Binary layout
-------------
``embeddings.bin`` is a *headerless* concatenation of fixed-size records. Each
movie's vector is ``EMBED_DIM`` IEEE-754 32-bit little-endian floats packed back
to back with ``struct`` — exactly ``EMBED_DIM * 4`` bytes per movie and **zero**
formatting overhead (no JSON, no keys, no delimiters). The matching movie record
in ``movies.pbf`` carries a ``v_idx`` pointer: the byte offset of its vector is
simply ``v_idx * EMBED_DIM * 4``. The browser slices the vector straight out of
the downloaded ``ArrayBuffer`` with a zero-copy ``Float32Array`` view.

``v_idx`` values are assigned strictly sequentially (0, 1, 2, …) in catalogue
order, so the file is a dense array with no gaps. The catalogue order is
append-only (``sync.py`` keeps existing movies first and appends new ones), so
vectors computed on a previous run are reused as-is and only newly added titles
are embedded.

What it does
------------
For every movie in ``movies.pbf`` this script combines the movie's ``title``,
``description``, ``primaryGenre``, ``genres``, ``director`` and ``cast`` into one
text string, embeds it into a fixed-length vector, packs the floats into
``embeddings.bin`` and stamps the movie's ``v_idx``. ``movies.pbf`` is rewritten
in place with the updated ``v_idx`` pointers.

Backends
--------
* **Local (default)** — a lightweight Hugging Face sentence-transformers model
  (``sentence-transformers/all-MiniLM-L6-v2``, 384 dims). Runs entirely offline
  on CPU, no API key required.
* **OpenAI** — pass ``--backend openai`` (or set ``EMBED_BACKEND=openai``) to use
  OpenAI's ``text-embedding-3-small``. Requires ``OPENAI_API_KEY``.
* **Gemini** — pass ``--backend gemini`` (or set ``EMBED_BACKEND=gemini``) to use
  Google's ``gemini-embedding-2``. Requires ``GEMINI_API_KEY`` or ``GOOGLE_API_KEY``.

Usage
-----
    pip install sentence-transformers protobuf    # local backend (default)
    python3 scripts/generate_embeddings.py --movies movies.pbf --embeddings embeddings.bin

    # or, using OpenAI:
    pip install openai protobuf
    export OPENAI_API_KEY=sk-...
    python3 scripts/generate_embeddings.py --backend openai

    # or, using Gemini:
    pip install google-genai protobuf
    export GEMINI_API_KEY=AIza...
    python3 scripts/generate_embeddings.py --backend gemini
"""

from __future__ import annotations

import argparse
import os
import struct
import sys
from typing import Any, Dict, List, Optional, Sequence

import catalog_io

# Default models per backend.
LOCAL_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
OPENAI_MODEL = "text-embedding-3-small"

# Vector dimensionality and on-disk record size. ``all-MiniLM-L6-v2`` emits 384
# dims; OpenAI's ``text-embedding-3-small`` is 1536 by default but can be asked
# to natively emit a lower dimensionality. The value is configurable via the
# ``EMBED_DIM`` environment variable or the ``--dim`` flag so a build can switch
# backend/dimension profiles; the on-disk layout (``EMBED_DIM * 4`` bytes per
# movie) and the browser's ``Float32Array`` jump index both derive from it, so
# they stay in lock-step automatically.
#
# NOTE: the matching ``EMBED_DIM`` constant in ``index.html`` must equal whatever
# dimensionality ``embeddings.bin`` is written with, since the file is headerless.
DEFAULT_EMBED_DIM = 384
EMBED_DIM = int(os.environ.get("EMBED_DIM", DEFAULT_EMBED_DIM))
BYTES_PER_VECTOR = EMBED_DIM * 4

# Little-endian 32-bit float layout, matching the browser's Float32Array view.
_VECTOR_STRUCT = struct.Struct("<%df" % EMBED_DIM)


def set_embed_dim(dim: int) -> None:
    """Reconfigure the embedding dimensionality and derived storage layout.

    Updating ``EMBED_DIM`` re-derives the per-record byte size and the ``struct``
    packer so the on-disk ``embeddings.bin`` records (and therefore the browser's
    ``v_idx * EMBED_DIM * 4`` jump offsets) automatically match the chosen
    backend profile.
    """
    global EMBED_DIM, BYTES_PER_VECTOR, _VECTOR_STRUCT
    if dim <= 0:
        raise ValueError(f"EMBED_DIM must be a positive integer, got {dim!r}.")
    EMBED_DIM = dim
    BYTES_PER_VECTOR = dim * 4
    _VECTOR_STRUCT = struct.Struct("<%df" % dim)


def _as_text(value: Any) -> str:
    """Flatten a movie field (string, list, or None) into a plain string."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(_as_text(v) for v in value if v not in (None, ""))
    return str(value).strip()


def movie_text(movie: Dict[str, Any]) -> str:
    """Render a movie's fields as a structured natural-language prompt.

    A natural-language template (``Title: ... Director: ... Overview: ...``)
    gives the embedding model far clearer semantic cues than raw pipe-joined
    fields, which improves the quality of the similarity space the recommender
    ranks against. Empty fields are dropped so the prompt never carries dangling
    labels like ``Director: .``.
    """
    budget_val = movie.get("budget", 0) or 0
    revenue_val = movie.get("revenue", 0) or 0
    runtime_val = movie.get("runtime", 0) or 0
    vote_avg_val = movie.get("vote_average", 0.0) or 0.0

    fields = (
        ("Title", _as_text(movie.get("title"))),
        ("Year", _as_text(movie.get("year"))),
        ("Director", _as_text(movie.get("director"))),
        ("Cast", _as_text(movie.get("cast"))),
        ("Genres", _as_text(movie.get("genres")) or _as_text(movie.get("primaryGenre"))),
        ("Overview", _as_text(movie.get("description"))),
        ("Release Date", _as_text(movie.get("release_date"))),
        ("Runtime", f"{runtime_val} minutes" if runtime_val > 0 else ""),
        ("Budget", f"${budget_val:,}" if budget_val > 0 else ""),
        ("Revenue", f"${revenue_val:,}" if revenue_val > 0 else ""),
        ("Origin Country", _as_text(movie.get("origin_country"))),
        ("Vote Average", str(vote_avg_val) if vote_avg_val > 0.0 else ""),
        ("Status", _as_text(movie.get("status"))),
        ("Keywords", _as_text(movie.get("keywords"))),
    )
    return ". ".join(f"{label}: {value}" for label, value in fields if value)


def pack_vector(vector: Sequence[float]) -> bytes:
    """Pack a vector into ``BYTES_PER_VECTOR`` little-endian float32 bytes.

    Vectors are normalised to exactly ``EMBED_DIM`` components (truncated or
    zero-padded) so every record is a fixed size and ``v_idx`` offsets stay
    aligned even if a backend ever returns an unexpected dimensionality.
    """
    floats = [float(x) for x in vector[:EMBED_DIM]]
    if len(floats) < EMBED_DIM:
        floats.extend([0.0] * (EMBED_DIM - len(floats)))
    return _VECTOR_STRUCT.pack(*floats)


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
        # Request the target dimensionality natively. ``text-embedding-3-*``
        # models support Matryoshka truncation via the ``dimensions`` parameter,
        # which re-projects the vector so it stays geometrically valid — unlike a
        # naive ``vector[:EMBED_DIM]`` slice, which corrupts the latent space.
        resp = self._client.embeddings.create(
            model=self._model, input=list(texts), dimensions=EMBED_DIM
        )
        # Preserve request order (the API echoes an index per item).
        ordered = sorted(resp.data, key=lambda d: d.index)
        return [list(d.embedding) for d in ordered]


class GeminiBackend:
    """Google Gemini embedding backend. Requires GEMINI_API_KEY or GOOGLE_API_KEY."""

    def __init__(self, model_name: str = "gemini-embedding-2") -> None:
        from google import genai

        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError(
                "Neither GEMINI_API_KEY nor GOOGLE_API_KEY is set, but --backend gemini was requested."
            )
        self._client = genai.Client(api_key=api_key.strip())
        self._model = model_name

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        # Google's text-embedding models support a maximum output_dimensionality
        # of 768. If EMBED_DIM exceeds 768, we cap the requested dimensionality
        # at 768 and let pack_vector zero-pad the resulting vectors.
        dim = min(EMBED_DIM, 768)
        resp = self._client.models.embed_content(
            model=self._model,
            contents=list(texts),
            config={"output_dimensionality": dim}
        )
        if not resp.embeddings:
            return []
        return [list(emb.values) for emb in resp.embeddings if emb.values is not None]


def make_backend(name: str):
    if name == "openai":
        return OpenAIBackend()
    if name == "gemini":
        return GeminiBackend()
    if name == "local":
        return LocalBackend()
    raise ValueError(f"Unknown backend: {name!r}")


def load_existing_vectors(path: str) -> List[bytes]:
    """Read previously computed fixed-size vector records from ``embeddings.bin``.

    Returns a list of ``BYTES_PER_VECTOR``-sized byte records (one per movie, in
    catalogue order). Because the catalogue is append-only, record ``i`` is the
    vector for the movie at position ``i``, so unchanged titles can be reused
    without re-embedding. A missing or malformed file yields an empty list.
    """
    if not os.path.exists(path):
        return []
    try:
        with open(path, "rb") as handle:
            buffer = handle.read()
    except OSError:
        return []
    count = len(buffer) // BYTES_PER_VECTOR
    return [buffer[i * BYTES_PER_VECTOR : (i + 1) * BYTES_PER_VECTOR] for i in range(count)]


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--movies", "--input", dest="movies_path", default="movies.pbf",
                        help="Path to the movies catalogue to read and update (default: movies.pbf).")
    parser.add_argument("--embeddings", "--output", dest="embeddings_path", default="embeddings.bin",
                        help="Path to the packed embeddings binary to write (default: embeddings.bin).")
    parser.add_argument("--backend", choices=("local", "openai", "gemini"),
                        default=os.environ.get("EMBED_BACKEND", "local"),
                        help="Embedding backend to use (default: local sentence-transformers).")
    parser.add_argument("--dim", type=int, default=EMBED_DIM,
                        help="Embedding dimensionality and on-disk record size "
                             "(default: %(default)s; also settable via EMBED_DIM env).")
    parser.add_argument("--batch-size", type=int, default=256,
                        help="How many movie texts to embed per backend call (default: 256).")
    parser.add_argument("--limit", type=int, default=0,
                        help="Optional cap on the number of NEW movies to embed this run (0 = no limit).")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    set_embed_dim(args.dim)

    catalog = catalog_io.load_catalog_proto(args.movies_path)
    movies = catalog.movies
    total = len(movies)

    # Reuse vectors computed on a previous run. The catalogue is append-only, so
    # record ``i`` of the old binary is the vector for the movie at position ``i``.
    cached = load_existing_vectors(args.embeddings_path)
    cached_count = min(len(cached), total)

    # Movies that still need an embedding are the ones past the cached prefix.
    pending_indices = list(range(cached_count, total))
    if args.limit > 0:
        pending_indices = pending_indices[: args.limit]

    new_vectors: Dict[int, bytes] = {}
    if pending_indices:
        print(f"Embedding {len(pending_indices)} of {total} movies via '{args.backend}' backend...")
        backend = make_backend(args.backend)
        done = 0
        for start in range(0, len(pending_indices), args.batch_size):
            chunk = pending_indices[start : start + args.batch_size]
            texts = [movie_text(catalog_io.movie_proto_to_dict(movies[i])) for i in chunk]
            vectors = backend.embed(texts)
            if len(vectors) != len(chunk):
                raise RuntimeError(
                    f"Backend returned {len(vectors)} vectors for {len(chunk)} inputs."
                )
            for idx, vector in zip(chunk, vectors):
                new_vectors[idx] = pack_vector(vector)
            done += len(chunk)
            print(f"  embedded {done}/{len(pending_indices)}", flush=True)
    else:
        print("All movies already have embeddings — nothing to embed.")

    # Assemble the dense, headerless binary in catalogue order and stamp each
    # movie's sequential ``v_idx`` pointer. We only write vectors we actually
    # have (cached prefix + freshly embedded), so any movies skipped by --limit
    # are left out of this pass; a subsequent unlimited run completes them.
    blob = bytearray()
    written = 0
    for i, movie in enumerate(movies):
        if i < cached_count:
            record = cached[i]
        elif i in new_vectors:
            record = new_vectors[i]
        else:
            break  # reached the --limit cut-off; stop the contiguous array here.
        movie.v_idx = written
        blob.extend(record)
        written += 1

    # Check if the total size exceeds 100MB (100 * 1024 * 1024 bytes)
    max_size = 100 * 1024 * 1024
    total_size = len(blob)
    embeddings_dir = os.path.dirname(args.embeddings_path) or "."

    # Always clean up any existing part files to avoid leftovers
    if os.path.exists(embeddings_dir):
        for f in os.listdir(embeddings_dir):
            if f.startswith("embeddings_part") and f.endswith(".bin"):
                try:
                    os.remove(os.path.join(embeddings_dir, f))
                except OSError:
                    pass

    if total_size > max_size:
        # Split into chunks of 50MB (50 * 1024 * 1024 bytes)
        chunk_size_bytes = 50 * 1024 * 1024
        # Align to BYTES_PER_VECTOR to avoid split vectors
        chunk_size = (chunk_size_bytes // BYTES_PER_VECTOR) * BYTES_PER_VECTOR
        if chunk_size == 0:
            chunk_size = BYTES_PER_VECTOR

        part_idx = 0
        offset = 0
        while offset < total_size:
            chunk_data = blob[offset : offset + chunk_size]
            part_path = os.path.join(embeddings_dir, f"embeddings_part{part_idx}.bin")
            tmp_part_path = part_path + ".tmp"
            with open(tmp_part_path, "wb") as handle:
                handle.write(chunk_data)
            os.replace(tmp_part_path, part_path)
            part_idx += 1
            offset += chunk_size

        # Remove the master file to prevent loading outdated single file
        if os.path.exists(args.embeddings_path):
            try:
                os.remove(args.embeddings_path)
            except OSError:
                pass
        print(f"Split {total_size} bytes into {part_idx} chunk files because total size exceeded 100MB.")
    else:
        tmp_path = args.embeddings_path + ".tmp"
        with open(tmp_path, "wb") as handle:
            handle.write(bytes(blob))
        os.replace(tmp_path, args.embeddings_path)
        print(f"Wrote {args.embeddings_path} with {written} vectors.")

    catalog_io.save_catalog_proto(args.movies_path, catalog)

    print(
        f"Updated {args.movies_path} and completed writing embeddings."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
