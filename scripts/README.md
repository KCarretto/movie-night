# Movie catalogue sync

`movies.pbf` (the recommendation database the app reads at runtime) is **not**
hand-maintained. Movie Night is a serverless static site, so we cannot safely
call a movie API from the browser (it would leak an API key and hit CORS/rate
limits). Instead we generate the catalogue at build time with
[`sync.py`](./sync.py) and commit the result.

`movies.pbf` is a dense [Protobuf](https://protobuf.dev/) binary described by
[`catalog.proto`](./catalog.proto). It replaces the older plain-text
`movies.json`: storing ratings as small integer varints, genres/languages as
enum varints and the poster path without its repeated base domain roughly halves
the on-disk size and removes the browser's JSON parse cost entirely (the page
decodes it with protobuf.js straight from an `ArrayBuffer`). The shared
[`catalog_io.py`](./catalog_io.py) helper owns the dict ⇆ Protobuf translation.

## Building the Protobuf bindings

Both scripts import `catalog_pb2`, generated from `catalog.proto`. It is **not**
committed; generate it once before running the scripts:

```bash
pip install protobuf grpcio-tools
python -m grpc_tools.protoc -I scripts --python_out scripts scripts/catalog.proto
```

## Running it

```bash
export TMDB_API_KEY=xxxxxxxx     # required — https://www.themoviedb.org/settings/api
export OMDB_API_KEY=yyyyyyyy     # optional — https://www.omdbapi.com/apikey.aspx
python3 scripts/sync.py --pages 25 --output movies.pbf
```

- `--pages 25` pulls ~1,000 movies (TMDB returns 20 per page; the script reads
  both the `top_rated` and `popular` lists and de-dupes). TMDB caps its lists at
  500 pages, so larger values are clamped automatically instead of erroring.
- `--ids-file` imports movie ids from a TMDB daily export
  (`movie_ids_MM_DD_YYYY.json`, newline-delimited JSON from
  <https://files.tmdb.org/p/exports/>). It defaults to today's filename and is
  silently ignored when the file is absent. Ids already in the catalogue (matched
  by `tmdb_id`) are skipped unless `--refresh` is given.
- `--pause` sets the delay (seconds) between TMDB requests to stay within rate
  limits (default `0.25`). A live spinner shows download progress.
- By default the script **resumes**: it loads the existing `--output` file and
  only downloads movies it doesn't already have. Pass `--refresh` to rebuild
  the whole catalogue from scratch.
- Needs `protobuf` installed (for the generated bindings); otherwise standard
  library only.

## Data sources & ratings

| Field            | Source                                                        |
| ---------------- | ------------------------------------------------------------- |
| title, year, genres, language, description, art | TMDB                       |
| `tmdb_id`        | TMDB movie id (used to skip already-downloaded movies)        |
| `ratings.imdb`   | OMDb IMDb rating (falls back to TMDB vote average)            |
| `ratings.rottenTomatoes` | OMDb Rotten Tomatoes Tomatometer (`null` without OMDb)|
| `ratings.letterboxd` | Estimated as TMDB `vote_average / 2` (no public API)     |

`language` is mapped from the primary (original) ISO 639-1 code to a
`LanguageCode` enum; the app maps it back and badges non-English films with the
matching country flag. Genres map to the `Genre` enum (case-insensitive),
falling back to `GENRE_UNKNOWN` for unmapped categories. Ratings are stored as
0-100 integer varints (IMDb/Letterboxd ×10, Rotten Tomatoes as-is) and inflated
back to floats in the browser. Only the relative poster path is stored; the
TMDB base domain is re-added at load time.

## ML embeddings (`embeddings.bin`)

Recommendations are powered by static semantic vectors generated at build time by
[`generate_embeddings.py`](./generate_embeddings.py) and written to a **separate**
`embeddings.bin` (kept out of `movies.pbf` so the catalogue stays small and the
UI renders instantly; the browser lazy-loads the vectors in the background).

```bash
pip install sentence-transformers protobuf   # local backend (default, offline, no key)
python3 scripts/generate_embeddings.py --movies movies.pbf --embeddings embeddings.bin
```

- Uses `sentence-transformers/all-MiniLM-L6-v2` (384-dim vectors).
- `embeddings.bin` is a **headerless** binary: each movie's vector is 384 IEEE-754
  32-bit little-endian floats packed back to back with `struct` — exactly
  `384 × 4 = 1,536` bytes per movie, no keys or delimiters. Each movie record in
  `movies.pbf` carries a sequential `v_idx` pointer, so its vector lives at byte
  offset `v_idx × 1536`. The browser slices it out zero-copy with a
  `Float32Array` view — no per-lookup parsing on the main thread.
- Resumes by default: because the catalogue is append-only, vectors already in
  `embeddings.bin` are reused and only newly added titles are embedded. The script
  rewrites `movies.pbf` in place with the updated `v_idx` pointers.
- Pass `--backend openai` (with `OPENAI_API_KEY`) to use OpenAI embeddings instead.

## Automating it

`.github/workflows/sync-movies.yml` runs this script twice a day (10:00 and
22:00 UTC, or on demand from the Actions tab). It compiles the Protobuf bindings,
downloads and unzips TMDB's daily id export, runs `sync.py` to import those ids
and discover 500 pages of movies, then runs `generate_embeddings.py` for any new
titles, and commits any changes to `movies.pbf` and `embeddings.bin` on `main`.
Add `TMDB_API_KEY` (and optionally `OMDB_API_KEY`) as repository secrets to
enable it.
