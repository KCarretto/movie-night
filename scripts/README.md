# Movie catalogue sync

`movies.json` (the recommendation database the app reads at runtime) is **not**
hand-maintained. Movie Night is a serverless static site, so we cannot safely
call a movie API from the browser (it would leak an API key and hit CORS/rate
limits). Instead we generate the catalogue at build time with
[`sync.py`](./sync.py) and commit the result.

## Running it

```bash
export TMDB_API_KEY=xxxxxxxx     # required — https://www.themoviedb.org/settings/api
export OMDB_API_KEY=yyyyyyyy     # optional — https://www.omdbapi.com/apikey.aspx
python3 scripts/sync.py --pages 25 --output movies.json
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
- Standard library only — nothing to `pip install`.

## Data sources & ratings

| Field            | Source                                                        |
| ---------------- | ------------------------------------------------------------- |
| title, year, genres, language, description, art | TMDB                       |
| `tmdb_id`        | TMDB movie id (used to skip already-downloaded movies)        |
| `ratings.imdb`   | OMDb IMDb rating (falls back to TMDB vote average)            |
| `ratings.rottenTomatoes` | OMDb Rotten Tomatoes Tomatometer (`null` without OMDb)|
| `ratings.letterboxd` | Estimated as TMDB `vote_average / 2` (no public API)     |

`language` is the primary (original) language as an ISO 639-1 code; the app
badges non-English films with the matching country flag in the rankings display.

## Automating it

`.github/workflows/sync-movies.yml` runs this script twice a day (10:00 and
22:00 UTC, or on demand from the Actions tab). It downloads and unzips TMDB's
daily id export, runs `sync.py` to import those ids and discover 500 pages of
movies, and commits any changes to `movies.json` on `main`. Add `TMDB_API_KEY`
(and optionally `OMDB_API_KEY`) as repository secrets to enable it.
