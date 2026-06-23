// ======================================================================
//  MOVIE RECOMMENDATION DATABASE (data/movies.pbf, loaded once at startup)
// ======================================================================
// The catalogue is generated at build time by scripts/sync.py and served as a
// dense Protobuf binary (movies.pbf, schema in scripts/catalog.proto). After
// decoding, each entry is inflated back to the descriptive runtime shape the UI
// expects.

import protobuf from 'protobufjs/light';
import { normTitle, dbKey } from './format.js';
import { runtime, emit } from './runtime.js';
import { loadEmbeddings } from './embeddings.js';
import { cachedFetch } from './datacache.js';

// Base TMDB poster domain. sync.py stores only the relative path suffix in the
// binary catalogue (e.g. "/lh4v5.jpg"); we re-prefix it here at load time.
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

// Numeric Genre enum (catalog.proto) -> readable UI string. 99 = UNKNOWN.
const GENRE_STRINGS = {
  1: 'Action', 2: 'Adventure', 3: 'Animation', 4: 'Comedy', 5: 'Crime',
  6: 'Documentary', 7: 'Drama', 8: 'Family', 9: 'Fantasy', 10: 'History',
  11: 'Horror', 12: 'Music', 13: 'Mystery', 14: 'Romance', 15: 'Science Fiction',
  16: 'TV Movie', 17: 'Thriller', 18: 'War', 19: 'Western', 99: 'Unknown',
};
// Numeric LanguageCode enum (catalog.proto) -> ISO 639-1 code.
const LANGUAGE_STRINGS = {
  1: 'en', 2: 'fr', 3: 'es', 4: 'de', 5: 'it', 6: 'pt', 7: 'ru',
  8: 'ja', 9: 'ko', 10: 'zh', 11: 'hi',
};

// protobuf.js reflection descriptor for catalog.proto. Enum fields are read as
// plain int32 so unknown/future enum values still decode gracefully.
const CATALOG_PROTO = {
  nested: { movie_night: { nested: {
    Movie: { fields: {
      id: { type: 'uint32', id: 1 },
      year: { type: 'uint32', id: 2 },
      language: { type: 'int32', id: 3 },
      letterboxdRating: { type: 'uint32', id: 4 },
      rottenTomatoesRating: { type: 'uint32', id: 5 },
      imdbRating: { type: 'uint32', id: 6 },
      primaryGenre: { type: 'int32', id: 7 },
      genres: { rule: 'repeated', type: 'int32', id: 8 },
      title: { type: 'string', id: 9 },
      description: { type: 'string', id: 10 },
      artPath: { type: 'string', id: 11 },
      vIdx: { type: 'uint32', id: 12 },
      director: { rule: 'repeated', type: 'string', id: 13 },
      cast: { rule: 'repeated', type: 'string', id: 14 },
      voteCount: { type: 'uint32', id: 15 },
      popularity: { type: 'float', id: 16 },
      releaseDate: { type: 'string', id: 17 },
      runtime: { type: 'uint32', id: 18 },
      budget: { type: 'uint32', id: 19 },
      revenue: { type: 'uint64', id: 20 },
      originCountry: { rule: 'repeated', type: 'string', id: 21 },
      voteAverage: { type: 'float', id: 22 },
      status: { type: 'string', id: 23 },
      imdbId: { type: 'string', id: 24 },
      keywords: { rule: 'repeated', type: 'string', id: 25 },
    } },
    MovieCatalog: { fields: {
      movies: { rule: 'repeated', type: 'Movie', id: 1 },
    } },
  } } },
};

// Inflate one decoded Protobuf Movie back into the descriptive runtime schema.
function inflateMovie(m) {
  const genres = (m.genres || []).map((g) => GENRE_STRINGS[g]).filter(Boolean);
  const primaryGenre = GENRE_STRINGS[m.primaryGenre] || genres[0] || '';
  return {
    id: m.id || undefined,
    tmdb_id: m.id || undefined,
    title: m.title || '',
    year: m.year || undefined,
    language: LANGUAGE_STRINGS[m.language] || '',
    primaryGenre,
    genres: genres.length ? genres : (primaryGenre ? [primaryGenre] : []),
    description: m.description || '',
    art: m.artPath ? (TMDB_IMAGE_BASE + m.artPath) : '',
    ratings: {
      imdb: m.imdbRating ? m.imdbRating / 10 : null,
      rottenTomatoes: m.rottenTomatoesRating ? m.rottenTomatoesRating : null,
      letterboxd: m.letterboxdRating ? m.letterboxdRating / 10 : null,
    },
    vIdx: (m.vIdx != null ? m.vIdx : null),
    cast: (m.cast && m.cast.length) ? m.cast : undefined,
    director: (m.director && m.director.length) ? m.director : undefined,
    voteCount: m.voteCount || 0,
    popularity: m.popularity || 0,
    release_date: m.releaseDate || '',
    runtime: m.runtime || 0,
    budget: m.budget || 0,
    revenue: m.revenue ? (typeof m.revenue === 'object' && m.revenue.toNumber ? m.revenue.toNumber() : m.revenue) : 0,
    origin_country: m.originCountry || [],
    vote_average: m.voteAverage || 0,
    status: m.status || '',
    imdb_id: m.imdbId || '',
    keywords: m.keywords || [],
  };
}

// Compiled MovieCatalog decoder (lazily built from CATALOG_PROTO).
let _MovieCatalogType = null;
function movieCatalogType() {
  if (_MovieCatalogType) return _MovieCatalogType;
  const root = protobuf.Root.fromJSON(CATALOG_PROTO);
  _MovieCatalogType = root.lookupType('movie_night.MovieCatalog');
  return _MovieCatalogType;
}

function indexMovieDb() {
  const { movieByTitle, movieByKey, movieById, MOVIE_DB } = runtime;
  movieByTitle.clear();
  movieByKey.clear();
  movieById.clear();
  MOVIE_DB.forEach((m) => {
    if (m && m.title) {
      movieByTitle.set(normTitle(m.title), m);
      const k = dbKey(m.title);
      if (k && !movieByKey.has(k)) movieByKey.set(k, m);
      if (m.id) movieById.set(m.id, m);
    }
  });
}

// Look up a catalogue entry for a nominated title. Falls back to the looser
// punctuation-insensitive key so freeform titles still match.
export function movieMeta(title, id) {
  if (id && runtime.movieById.has(id)) return runtime.movieById.get(id);
  if (!title) return null;
  return runtime.movieByTitle.get(normTitle(title))
    || runtime.movieByKey.get(dbKey(title))
    || null;
}

// Fetch + decode the catalogue, then lazy-load the embeddings in the background.
// `onEmbeddingsReady` lets the controller re-share the local taste vector once
// the embedding buffer resolves.
export async function loadMovieDb({ onEmbeddingsReady } = {}) {
  runtime.movieDbStatus = 'loading';
  runtime.movieDbError = '';
  try {
    // Served from a persistent stale-while-revalidate cache so repeat loads
    // skip re-downloading the ~12 MB catalogue.
    const res = await cachedFetch('data/movies.pbf');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const Catalog = movieCatalogType();
    if (!Catalog) throw new Error('protobuf decoder unavailable');
    const decoded = Catalog.decode(new Uint8Array(buf));
    runtime.MOVIE_DB = (decoded.movies || []).map(inflateMovie);
    runtime.movieDbStatus = 'ready';
  } catch (e) {
    runtime.MOVIE_DB = [];
    runtime.movieDbStatus = 'error';
    runtime.movieDbError = (e && e.message) ? e.message : 'unknown error';
    console.warn('Could not load movies.pbf:', e);
  }
  indexMovieDb();
  // Mark embeddings as loading up-front so the carousel shimmers rather than
  // briefly flashing popularity-only picks before loadEmbeddings() flips status.
  if (runtime.movieDbStatus === 'ready') runtime.embeddingsStatus = 'loading';
  emit();
  if (runtime.movieDbStatus === 'ready') {
    loadEmbeddings({ onReady: onEmbeddingsReady });
  } else {
    runtime.embeddingsStatus = 'idle';
    runtime.embeddingsError = '';
  }
}
