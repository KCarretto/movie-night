# Movie catalogue generator

`movies.json` (the recommendation database the app reads at runtime) is **not**
hand-maintained. Movie Night is a serverless static site, so we cannot safely
call a movie API from the browser (it would leak an API key and hit CORS/rate
limits). Instead we generate the catalogue at build time with
[`generate_movies.py`](./generate_movies.py) and commit the result.

## Running it

```bash
export TMDB_API_KEY=xxxxxxxx     # required — https://www.themoviedb.org/settings/api
export OMDB_API_KEY=yyyyyyyy     # optional — https://www.omdbapi.com/apikey.aspx
python3 scripts/generate_movies.py --pages 25 --output movies.json
```

- `--pages 25` pulls ~1,000 movies (TMDB returns 20 per page; the script reads
  both the `top_rated` and `popular` lists and de-dupes).
- Standard library only — nothing to `pip install`.

## Data sources & ratings

| Field            | Source                                                        |
| ---------------- | ------------------------------------------------------------- |
| title, year, genres, description, art | TMDB                                     |
| `ratings.imdb`   | OMDb IMDb rating (falls back to TMDB vote average)            |
| `ratings.rottenTomatoes` | OMDb Rotten Tomatoes Tomatometer (`null` without OMDb)|
| `ratings.letterboxd` | Estimated as TMDB `vote_average / 2` (no public API)     |

## Automating it

`.github/workflows/update-movies.yml` runs this script (monthly, or on demand
from the Actions tab) and commits any changes. Add `TMDB_API_KEY` (and
optionally `OMDB_API_KEY`) as repository secrets to enable it.
