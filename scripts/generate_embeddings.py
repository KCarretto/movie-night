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
* **Gemini (default)** — pass ``--backend gemini`` (the default; or set
  ``EMBED_BACKEND=gemini``) to use Google's ``gemini-embedding-2`` (3072 dims) via
  the stable synchronous models API (``client.models.embed_content``), which
  completely avoids the buggy batch infrastructure. Requires ``GEMINI_API_KEY``
  or ``GOOGLE_API_KEY``.
* **Local** — pass ``--backend local`` to use a lightweight Hugging Face
  sentence-transformers model (``sentence-transformers/all-MiniLM-L6-v2``, 384
  dims). Runs entirely offline on CPU, no API key required.
* **OpenAI** — pass ``--backend openai`` (or set ``EMBED_BACKEND=openai``) to use
  OpenAI's ``text-embedding-3-small``. Requires ``OPENAI_API_KEY``.

Usage
-----
    pip install google-genai protobuf             # gemini backend (default)
    export GEMINI_API_KEY=AIza...
    python3 scripts/generate_embeddings.py --movies public/data/movies.pbf --embeddings public/data/embeddings.bin

    # or, offline with sentence-transformers:
    pip install sentence-transformers protobuf
    python3 scripts/generate_embeddings.py --backend local

    # or, using OpenAI:
    pip install openai protobuf
    export OPENAI_API_KEY=sk-...
    python3 scripts/generate_embeddings.py --backend openai
"""

from __future__ import annotations

import argparse
import os
import struct
import sys
import time
from typing import Any, Dict, List, Optional, Sequence

import catalog_io


# ---------------------------------------------------------------------------
# Progress reporting
# ---------------------------------------------------------------------------
class Progress:
    """Tiny spinner / progress indicator so long embedding runs show they're alive.

    Mirrors the indicator used by ``sync.py``: on a TTY it animates a single
    in-place line (spinner + count + percentage); when the stream is redirected
    (e.g. CI logs) it prints occasional standalone lines instead, so logs stay
    readable without thousands of carriage returns.

    ``advance`` bumps the completed count (e.g. after a batch of movies is
    embedded); ``tick`` just re-renders to show liveness while waiting on a
    long-running async batch job, without changing the count.
    """

    FRAMES = "|/-\\"

    def __init__(self, label: str, total: Optional[int] = None, stream=sys.stderr):
        self.label = label
        self.total = total if (total is None or total > 0) else None
        self.stream = stream
        self.count = 0
        self._frame = 0
        self._last_suffix: Optional[str] = None
        self._tty = bool(getattr(stream, "isatty", lambda: False)())

    def advance(self, n: int = 1, suffix: str = "") -> None:
        self.count += n
        self._frame += 1
        self._render(suffix, force=True)

    def tick(self, suffix: str = "") -> None:
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

    def _render(self, suffix: str, force: bool = False) -> None:
        line = self._line(suffix)
        if self._tty:
            self.stream.write("\r\033[K" + line)
            self.stream.flush()
        elif force or suffix != self._last_suffix:
            # In CI logs, only emit a standalone line when something meaningful
            # changed (a count advance or a new status) to avoid spamming.
            self.stream.write(line + "\n")
            self.stream.flush()
        self._last_suffix = suffix

    def done(self, suffix: str = "") -> None:
        line = self._line(suffix)
        if self._tty:
            self.stream.write("\r\033[K" + line + "\n")
        else:
            self.stream.write(line + "\n")
        self.stream.flush()

# Default models per backend.
LOCAL_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
OPENAI_MODEL = "text-embedding-3-small"

# Vector dimensionality and on-disk record size. The default ``gemini-embedding-2``
# backend emits up to 3072 dims; ``all-MiniLM-L6-v2`` emits 384 and OpenAI's
# ``text-embedding-3-small`` is 1536 by default but can be asked to natively emit a
# lower dimensionality. The value is configurable via the ``EMBED_DIM`` environment
# variable or the ``--dim`` flag so a build can switch backend/dimension profiles;
# the on-disk layout (``EMBED_DIM * 4`` bytes per movie) and the browser's
# ``Float32Array`` jump index both derive from it, so they stay in lock-step
# automatically.
#
# NOTE: the matching ``EMBED_DIM`` constant in ``index.html`` must equal whatever
# dimensionality ``embeddings.bin`` is written with, since the file is headerless.
DEFAULT_EMBED_DIM = 3072
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


def _get_budget_vibe(budget: float) -> str:
    if budget <= 0: return ""
    if budget > 100000000: return "Blockbuster"
    if budget > 20000000: return "Mid Budget"
    if budget > 500000: return "Indie"
    return "Low Budget"

def _get_era(year_val: Any, release_date_val: Any) -> str:
    if year_val:
        year_str = str(year_val)
    elif release_date_val:
        year_str = str(release_date_val)
    else:
        return ""

    try:
        year = int(year_str[:4])
        return f"{year // 10 * 10}s"
    except (ValueError, TypeError):
        return ""

def _get_runtime_vibe(runtime: float) -> str:
    if runtime <= 0: return ""
    if runtime < 60: return "Short Film"
    if runtime < 90: return "Short Feature"
    if runtime <= 120: return "Feature Film"
    if runtime <= 150: return "Long Feature"
    return "Epic"

def _get_revenue_vibe(revenue: float) -> str:
    if revenue <= 0: return ""
    if revenue > 1000000000: return "Billion Dollar Blockbuster"
    if revenue > 500000000: return "Massive Box Office Hit"
    if revenue > 100000000: return "Box Office Hit"
    if revenue > 10000000: return "Commercial Success"
    return "Modest Box Office"

def _get_vote_vibe(vote_avg: float) -> str:
    if vote_avg <= 0: return ""
    if vote_avg >= 8.0: return "Critically Acclaimed"
    if vote_avg >= 7.0: return "Highly Rated"
    if vote_avg >= 6.0: return "Well Received"
    if vote_avg >= 5.0: return "Mixed Reviews"
    return "Poorly Received"


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
        ("Era", _get_era(movie.get("year"), movie.get("release_date"))),
        ("Director", _as_text(movie.get("director"))),
        ("Cast", _as_text(movie.get("cast"))),
        ("Genres", _as_text(movie.get("genres")) or _as_text(movie.get("primaryGenre"))),
        ("Overview", _as_text(movie.get("description"))),
        ("Origin Country", _as_text(movie.get("origin_country"))),
        ("Reception", _get_vote_vibe(vote_avg_val)),
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
    """Google Gemini embedding backend. Requires GEMINI_API_KEY or GOOGLE_API_KEY.

    Uses the stable synchronous models.embed_content API with an explicit structural
    type-wrapping envelope workaround to bypass list aggregation bugs in the SDK.
    """

    def __init__(
        self,
        model_name: str = "gemini-embedding-2",
        progress: Optional["Progress"] = None,
    ) -> None:
        from google import genai

        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError(
                "Neither GEMINI_API_KEY nor GOOGLE_API_KEY is set, but --backend gemini was requested."
            )
        self._client = genai.Client(api_key=api_key.strip())
        self._model = model_name if model_name.startswith("models/") else f"models/{model_name}"
        self._progress = progress

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        from google.genai import types

        dim = min(EMBED_DIM, 3072)
        texts = list(texts)
        if not texts:
            return []

        # Wrap each text inside explicit types.Content to prevent the 2.x SDK
        # from merging a standard text string list into 1 combined vector token
        contents = [types.Content(parts=[types.Part(text=t)]) for t in texts]

        retries = 6
        delay = 10  # Increased base sleep window to clear full RPM blocks smoothly
        while retries > 0:
            try:
                result = self._client.models.embed_content(
                    model=self._model,
                    contents=contents,
                    config=types.ContentConfig(output_dimensionality=dim) if hasattr(types, 'ContentConfig') else None
                )

                if not result.embeddings or len(result.embeddings) != len(texts):
                    raise RuntimeError(
                        f"Gemini API returned {len(result.embeddings) if result.embeddings else 0} "
                        f"vectors for {len(texts)} inputs."
                    )

                return [[float(x) for x in emb.values] for emb in result.embeddings]

            except Exception as e:
                # The google-genai SDK maps status identifiers under .code attribute
                error_code = getattr(e, "code", None)
                error_msg = str(e).upper()

                is_429 = (error_code == 429) or ("429" in error_msg) or ("RESOURCE_EXHAUSTED" in error_msg)

                if is_429 and retries > 1:
                    time.sleep(delay)
                    retries -= 1
                    delay *= 2
                else:
                    raise e

        raise RuntimeError("Failed to complete synchronous embedding generation call after maximum backoff attempts.")


def make_backend(name: str, progress: Optional[Progress] = None):
    if name == "openai":
        return OpenAIBackend()
    if name == "gemini":
        return GeminiBackend(progress=progress)
    if name == "local":
        return LocalBackend()
    raise ValueError(f"Unknown backend: {name!r}")


def load_existing_vectors(path: str) -> List[bytes]:
    """Read previously computed fixed-size vector records from ``embeddings.bin``."""
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
    parser.add_argument("--movies", "--input", dest="movies_path", default="public/data/movies.pbf",
                        help="Path to the movies catalogue to read and update (default: public/data/movies.pbf).")
    parser.add_argument("--embeddings", "--output", dest="embeddings_path", default="public/data/embeddings.bin",
                        help="Path to the packed embeddings binary to write (default: public/data/embeddings.bin).")
    parser.add_argument("--backend", choices=("local", "openai", "gemini"),
                        default=os.environ.get("EMBED_BACKEND", "gemini"),
                        help="Embedding backend to use (default: gemini).")
    parser.add_argument("--dim", type=int, default=EMBED_DIM,
                        help="Embedding dimensionality and on-disk record size "
                             "(default: %(default)s; also settable via EMBED_DIM env).")
    # 100 items per request ensures safe payload and text parsing boundaries
    parser.add_argument("--batch-size", type=int, default=100,
                        help="How many movie texts to embed per backend call (default: 100).")
    parser.add_argument("--limit", type=int, default=0,
                        help="Optional cap on the number of NEW movies to embed this run (0 = no limit).")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    set_embed_dim(args.dim)

    embeddings_dir = os.path.dirname(args.embeddings_path) or "."
    if embeddings_dir and embeddings_dir != ".":
        os.makedirs(embeddings_dir, exist_ok=True)

    movies_dir = os.path.dirname(args.movies_path) or "."
    if movies_dir and movies_dir != ".":
        os.makedirs(movies_dir, exist_ok=True)

    catalog = catalog_io.load_catalog_proto(args.movies_path)
    movies = catalog.movies
    total = len(movies)

    cached = load_existing_vectors(args.embeddings_path)
    cached_count = min(len(cached), total)

    pending_indices = list(range(cached_count, total))
    if args.limit > 0:
        pending_indices = pending_indices[: args.limit]

    new_vectors: Dict[int, bytes] = {}
    if pending_indices:
        print(f"Embedding {len(pending_indices)} of {total} movies via '{args.backend}' backend...")
        progress = Progress("Embedding", total=len(pending_indices))
        backend = make_backend(args.backend, progress=progress)

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
            progress.advance(len(chunk))

            # Tiny cool-off spacing block if executing on Gemini to balance high RPM throughput safely
            if args.backend == "gemini" and (start + args.batch_size) < len(pending_indices):
                time.sleep(0.4)

        progress.done(suffix="done")
    else:
        print("All movies already have embeddings — nothing to embed.")

    blob = bytearray()
    written = 0
    for i, movie in enumerate(movies):
        if i < cached_count:
            record = cached[i]
        elif i in new_vectors:
            record = new_vectors[i]
        else:
            break
        movie.v_idx = written
        blob.extend(record)
        written += 1

    max_size = 100 * 1024 * 1024
    total_size = len(blob)

    if os.path.exists(embeddings_dir):
        for f in os.listdir(embeddings_dir):
            if f.startswith("embeddings_part") and f.endswith(".bin"):
                try:
                    os.remove(os.path.join(embeddings_dir, f))
                except OSError:
                    pass

    if total_size > max_size:
        chunk_size_bytes = 50 * 1024 * 1024
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
    print(f"Updated {args.movies_path} and completed writing embeddings.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
