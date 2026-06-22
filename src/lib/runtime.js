// ======================================================================
//  RUNTIME — shared mutable app state + a tiny subscription bus
// ======================================================================
// The original single-file app kept its data-loading status, the authoritative
// network `state`, and the viewer's identity in module-level globals and called
// renderAll() after every mutation. We preserve that model here in one place so
// the framework-agnostic logic (catalogue, embeddings, recommendation engine,
// networking) can read/write it exactly as before, while the React layer simply
// subscribes via useSyncExternalStore and re-renders on emit().

export const runtime = {
  // ---- Recommendation catalogue (movies.pbf) ----
  MOVIE_DB: [],
  movieByTitle: new Map(), // normalized title -> db entry
  movieByKey: new Map(), // looser dbKey -> db entry (punctuation-insensitive)
  movieById: new Map(), // tmdb_id -> db entry
  movieDbStatus: 'idle', // idle | loading | ready | error
  movieDbError: '',

  // ---- Embeddings (embeddings_part*.bin) ----
  embeddingsStatus: 'idle', // idle | loading | ready | error
  embeddingsError: '',
  EMBEDDINGS_BUFFER: null, // ArrayBuffer | null

  // ---- Identity + connection ----
  isHost: false,
  roomId: null,
  myId: null,
  myName: '…',
  netStatus: { level: 'warn', text: 'Booting…' },
  connCount: 0,

  // ---- The authoritative network state (host owns it; guests mirror it) ----
  state: {
    phase: 'lobby', // 'lobby' | 'voting' | 'results'
    peers: [], // [{ id, name }] — ordered; index 0 is host
    movies: [], // [{ id, title, tmdbId, by }]
    votes: {}, // peerId -> [movieId ranked]
    results: null, // computed instant-runoff result
    seen: {}, // peerId -> [{ title, rating }]
    peerVectors: {}, // peerId -> 2D array of K-Means taste centroids
  },

  // ---- Recommendation UI state ----
  activeSelectedGenres: [],
  activeSelectedLanguages: [],
};

const listeners = new Set();

// Subscribe to runtime changes (used by the React useSyncExternalStore hook).
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A monotonically-increasing snapshot token. useSyncExternalStore compares this
// to know when to re-render; we bump it on every emit().
let version = 0;
export function getSnapshot() {
  return version;
}

// renderAll() equivalent: notify every subscriber that runtime changed.
export function emit() {
  version += 1;
  listeners.forEach((fn) => {
    try { fn(); } catch (e) { /* a bad listener shouldn't break the bus */ }
  });
}
