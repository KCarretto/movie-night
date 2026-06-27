// ======================================================================
//  LOCAL ML RECOMMENDATION ENGINE
// ======================================================================
// Vector-first recommender: clusters the viewer's liked-film embeddings into
// K-Means taste centroids and scores every catalogue entry by max-pooled cosine
// similarity to the room's centroids. Ported verbatim from the original app;
// global `state` / `myId` / `MOVIE_DB` now live on the shared runtime store.

import { runtime } from './runtime.js';
import { movieMeta } from './catalog.js';
import { movieEmbedding } from './embeddings.js';
import { isVector, normTitle, movieGenres } from './format.js';
import { cosineSimilarity, clusterCentroids } from './vector.js';
import {
  loadWatched, loadWatchlist, loadInterested, loadNotInterested, loadHistory,
  loadSeenRecommendations, saveSeenRecommendations,
} from './storage.js';

export const REC_CONFIG = {
  maxResults: 18,
  newSinceYear: new Date().getFullYear() - 2,
  newFraction: 0.35,
  maxCentroids: 5,
  centroidIters: 6,
  dislikeAlpha: 0.5,
  groupCentroids: 5,
  minVoteCount: 150,
  minPopularity: 2.0,
  credibilityThreshold: 10000,
  personaliseThreshold: 3,
  watchlistStrength: 2.0,
  notInterestedStrength: 1.5,
  watchlistInjectFraction: 0.15,
};

export const isNewMovie = (m) => !!(m && m.year && m.year >= REC_CONFIG.newSinceYear);

const isObscureMovie = (m) => {
  const votes = m && m.voteCount ? m.voteCount : 0;
  if (votes <= 0) return false;
  const pop = m && m.popularity ? m.popularity : 0;
  return votes < REC_CONFIG.minVoteCount || pop < REC_CONFIG.minPopularity;
};

// ---------- quality score ----------
function qualityScore(m) {
  const r = (m && m.ratings) || {};
  let sum = 0, n = 0;
  if (r.imdb != null) { sum += Math.max(0, Math.min(1, r.imdb / 10)); n += 1; }
  if (r.rottenTomatoes != null) { sum += Math.max(0, Math.min(1, r.rottenTomatoes / 100)); n += 1; }
  if (r.letterboxd != null) { sum += Math.max(0, Math.min(1, r.letterboxd / 5)); n += 1; }

  let score = n ? sum / n : 0.5;
  if (score < 0.5) {
    score *= 0.1; // Assign much lower weight for average rating below 2.5 (0.5 on 0-1 scale)
  }
  return score;
}

// ---------- audience-trust (log-scaled popularity) ----------
let _maxVoteLog = 0, _maxVoteLogFor = -1;
function maxVoteLog() {
  if (_maxVoteLogFor !== runtime.MOVIE_DB.length) {
    let maxVotes = 0;
    for (const m of runtime.MOVIE_DB) {
      const v = m && m.voteCount ? m.voteCount : 0;
      if (v > maxVotes) maxVotes = v;
    }
    _maxVoteLog = Math.log(maxVotes + 1) || 1;
    _maxVoteLogFor = runtime.MOVIE_DB.length;
  }
  return _maxVoteLog;
}

function popularityTrust(m) {
  const votes = m && m.voteCount ? m.voteCount : 0;
  if (votes <= 0) return 0.5;
  const threshold = REC_CONFIG.credibilityThreshold;
  if (!(threshold > 0)) return 0.5;
  if (votes >= threshold) return 1;
  const denom = Math.log(threshold + 1) || 1;
  return Math.max(0, Math.min(1, Math.log(votes + 1) / denom));
}

// ---------- secondary clustering: group taste centroids ----------
function computeGroupCentroids(localCentroids) {
  const samples = [];
  const pushSet = (vecs) => {
    if (!Array.isArray(vecs)) return;
    for (const v of vecs) {
      if (isVector(v)) samples.push({ emb: Array.from(v), weight: 1 });
    }
  };
  pushSet(localCentroids);
  const pv = (runtime.state && runtime.state.peerVectors) || {};
  Object.keys(pv).forEach((pid) => {
    if (pid === runtime.myId) return;
    pushSet(pv[pid]);
  });
  if (!samples.length) return [];
  return clusterCentroids(samples, REC_CONFIG.groupCentroids, REC_CONFIG.centroidIters);
}

// Cached primary centroid set so the broadcast path never re-clusters.
let _myCentroids = null;

// Build a vector-first taste profile from the viewer's history.
export function buildTasteProfile() {
  const positiveSamples = [];
  const dislikeAnchors = [];
  const likedGenres = new Map();

  function addPositive(meta, scalar, ageDays) {
    if (!(scalar > 0)) return;
    const recencyDecay = Math.exp(-(ageDays > 0 ? ageDays : 0) / 90);
    const weight = scalar * recencyDecay;
    if (!(weight > 0)) return;
    const emb = movieEmbedding(meta);
    if (!isVector(emb) || emb.length === 0) return;
    positiveSamples.push({ title: meta.title, emb, weight });
    movieGenres(meta).forEach((g) => likedGenres.set(g, (likedGenres.get(g) || 0) + weight));
  }
  function addDislike(meta) {
    const emb = movieEmbedding(meta);
    if (!isVector(emb) || emb.length === 0) return;
    dislikeAnchors.push(Array.from(emb));
  }

  const watched = loadWatched();
  let rated = 0;
  watched.forEach((wEntry) => {
    const meta = movieMeta(wEntry.title);
    if (!meta) return;
    const r = wEntry.rating || 0;
    if (r) rated += 1;
    const ageDays = (Date.now() - (wEntry.watchedAt || Date.now())) / (1000 * 60 * 60 * 24);
    if (r > 2.5) addPositive(meta, r - 2.5, ageDays);
    else if (r > 0 && r < 2.5) addDislike(meta);
    else if (r === 0) addPositive(meta, 0.5, ageDays);
  });

  const watchlist = loadWatchlist();
  watchlist.forEach((entry) => {
    const meta = movieMeta(entry.title);
    if (meta) addPositive(meta, REC_CONFIG.watchlistStrength, 0);
  });

  const interested = loadInterested();
  interested.forEach((entry) => {
    const meta = movieMeta(entry.title);
    if (!meta) return;
    const lvl = entry.interest || 0;
    const strength = lvl ? (lvl / 5) * 2 : 0.6;
    addPositive(meta, strength, 0);
  });

  const notInterested = loadNotInterested();
  notInterested.forEach((entry) => {
    const meta = movieMeta(entry.title);
    if (meta) addDislike(meta);
  });

  const trainingSignals = watchlist.length + interested.length + notInterested.length;
  const hasSignal = rated + watched.length + loadHistory().length + trainingSignals
                    >= REC_CONFIG.personaliseThreshold;

  const centroids = clusterCentroids(
    positiveSamples, REC_CONFIG.maxCentroids, REC_CONFIG.centroidIters);

  _myCentroids = centroids;

  const groupCentroids = computeGroupCentroids(centroids);

  return { centroids, groupCentroids, dislikeAnchors, positiveSamples, likedGenres,
           watchedCount: watched.length, ratedCount: rated, hasSignal };
}

// My current K-Means taste centroids (2D array), computed if not yet cached.
export function computeMyCentroids() {
  try { buildTasteProfile(); }
  catch (e) { /* embeddings may not be loaded yet */ }
  return (_myCentroids && _myCentroids.length) ? _myCentroids : [];
}
export function myTasteVector() {
  try {
    if (_myCentroids == null) buildTasteProfile();
  } catch (e) { /* embeddings may not be loaded yet */ }
  return (_myCentroids && _myCentroids.length) ? _myCentroids : [];
}

// ---------- candidate scoring ----------
function scoreCandidate(m, profile) {
  if (isObscureMovie(m)) return -Infinity;
  const emb = movieEmbedding(m);
  if (!isVector(emb)) return qualityScore(m);

  let best = -Infinity;
  if (profile.centroids) {
    for (const c of profile.centroids) {
      const s = cosineSimilarity(emb, c);
      if (s > best) best = s;
    }
  }
  if (profile.groupCentroids) {
    for (const c of profile.groupCentroids) {
      if (!isVector(c)) continue;
      const s = cosineSimilarity(emb, c);
      if (s > best) best = s;
    }
  }
  if (best === -Infinity) return qualityScore(m);

  let sim = Math.max(0, best);

  if (profile.dislikeAnchors && profile.dislikeAnchors.length) {
    let dis = 0;
    for (const d of profile.dislikeAnchors) {
      const s = cosineSimilarity(emb, d);
      if (s > dis) dis = s;
    }
    sim = Math.max(0, sim - REC_CONFIG.dislikeAlpha * dis);
  }

  return sim * qualityScore(m) * popularityTrust(m);
}

function coldStartScore(m) {
  if (isObscureMovie(m)) return -Infinity;
  const recency = isNewMovie(m) ? 0.15 : 0;
  return (qualityScore(m) * popularityTrust(m)) + recency;
}

// ---------- blend ----------
function blendRecommendations(ranked, max) {
  const newRanked = ranked.filter((r) => r.isNew);
  const oldRanked = ranked.filter((r) => !r.isNew);
  const out = [];
  const used = new Set();
  const trayGenres = new Set();
  const WINDOW = 12;
  let ni = 0, pi = 0, newCount = 0;

  function pickFrom(lane, startIdx) {
    let best = null, bestVal = -Infinity, scanned = 0;
    for (let i = startIdx; i < lane.length && scanned < WINDOW; i++) {
      const rec = lane[i];
      if (used.has(rec.movie)) continue;
      scanned++;
      const penalised = trayGenres.has(rec.movie.primaryGenre) ? rec.score * 0.85 : rec.score;
      if (penalised > bestVal) { bestVal = penalised; best = rec; }
    }
    return best;
  }

  while (out.length < max && (ni < newRanked.length || pi < oldRanked.length)) {
    const wantNew = newCount < Math.round((out.length + 1) * REC_CONFIG.newFraction);
    let pick = null;
    if (wantNew) {
      while (ni < newRanked.length && used.has(newRanked[ni].movie)) ni++;
      pick = pickFrom(newRanked, ni);
    }
    if (!pick) {
      while (pi < oldRanked.length && used.has(oldRanked[pi].movie)) pi++;
      pick = pickFrom(oldRanked, pi);
    }
    if (!pick) break;
    used.add(pick.movie);
    if (pick.isNew) newCount++;
    if (pick.movie.primaryGenre) trayGenres.add(pick.movie.primaryGenre);
    out.push(pick);
  }
  return out;
}

// ---------- main entry point ----------
function computeRecommendations(maxResults = REC_CONFIG.maxResults, profile = null) {
  if (!runtime.MOVIE_DB.length) return [];
  if (!profile) profile = buildTasteProfile();
  const personalised = profile.hasSignal;
  const seenSet = roomSeenTitles();
  const nominatedSet = new Set(runtime.state.movies.map((m) => normTitle(m.title)));
  const skipSet = new Set(loadNotInterested().map((x) => normTitle(x.title)));
  const watchlistSet = new Set(loadWatchlist().map((x) => normTitle(x.title)));
  const activeGenres = runtime.activeSelectedGenres;
  const activeLangs = runtime.activeSelectedLanguages;
  const candidates = [];
  for (const m of runtime.MOVIE_DB) {
    if (!m || !m.title || !m.art) continue;
    if (activeGenres.length > 0) {
      const genreMatch = (m.genres || []).some((g) => activeGenres.includes(g));
      if (!genreMatch) continue;
    }
    if (activeLangs.length > 0) {
      if (!activeLangs.includes(m.language)) continue;
    }
    const nt = normTitle(m.title);
    if (seenSet.has(nt) || nominatedSet.has(nt) || skipSet.has(nt)) continue;
    let score;
    if (personalised) score = scoreCandidate(m, profile);
    else score = coldStartScore(m);
    const onWatchlist = watchlistSet.has(nt);
    candidates.push({ movie: m, score, isNew: isNewMovie(m), personalised, fromWatchlist: onWatchlist });
  }
  candidates.sort((a, b) => b.score - a.score);
  return blendRecommendations(candidates, maxResults);
}

export function roomSeenTitles() {
  const out = new Set();
  loadWatched().forEach((w) => out.add(normTitle(w.title)));
  const seen = (runtime.state && runtime.state.seen) || {};
  Object.keys(seen).forEach((pid) => {
    const list = seen[pid];
    if (Array.isArray(list)) list.forEach((s) => s && s.title && out.add(normTitle(s.title)));
  });
  return out;
}

// ---- Memoisation + precompute ----------------------------------------------
let recCache = { sig: null, list: [], personalised: false, totalAvailable: 0 };
let recPrecompute = { sig: null, ranked: null, batches: [] };
let recRankingStale = false;

export function markRankingStale() {
  recRankingStale = true;
  _myCentroids = null;
}
export function getRecCache() { return recCache; }

function recSignature() {
  const hist = loadHistory().length;
  const intr = loadInterested().map((x) => normTitle(x.title) + ':' + (x.interest || 0)).join('|');
  const ni = loadNotInterested().map((x) => normTitle(x.title)).join('|');
  const watched = loadWatched().map((w) => normTitle(w.title) + ':' + (w.rating || 0)).join('|');
  const seen = (runtime.state && runtime.state.seen) || {};
  const seenSig = Object.keys(seen).filter((pid) => pid !== runtime.myId).sort().map((pid) =>
    pid + ':' + (Array.isArray(seen[pid]) ? seen[pid].length : 0)).join('|');
  const pv = (runtime.state && runtime.state.peerVectors) || {};
  const pvSig = Object.keys(pv).sort().join('|');
  const embReady = runtime.EMBEDDINGS_BUFFER ? '1' : '0';
  const filt = runtime.activeSelectedGenres.join(',') + '/' + runtime.activeSelectedLanguages.join(',');
  return runtime.MOVIE_DB.length + '#' + hist
       + '#' + intr + '#' + ni + '#' + watched
       + '#' + seenSig + '#' + pvSig + '#' + embReady + '#' + filt;
}

function nextRecBatch(ranked) {
  const seen = loadSeenRecommendations();
  const unseen = ranked.filter((rec) => !seen.has(normTitle(rec.movie.title)));
  const reserve = Math.max(1, Math.round(REC_CONFIG.maxResults * REC_CONFIG.watchlistInjectFraction));
  const watchlistRecs = unseen.filter((rec) => rec.fromWatchlist);
  const others = unseen.filter((rec) => !rec.fromWatchlist);
  const batch = others.slice(0, REC_CONFIG.maxResults);
  if (watchlistRecs.length) {
    const step = Math.max(2, Math.floor(REC_CONFIG.maxResults / (reserve + 1)));
    let inserted = 0, pos = step;
    for (const rec of watchlistRecs) {
      if (inserted >= reserve) break;
      batch.splice(Math.min(pos, batch.length), 0, rec);
      inserted++;
      pos += step + 1;
    }
  }
  const final = batch.slice(0, REC_CONFIG.maxResults);
  final.forEach((rec) => seen.add(normTitle(rec.movie.title)));
  saveSeenRecommendations(seen);
  return final;
}

function ensurePrecompute(sig, profile = null, forceRecompute = false) {
  if (forceRecompute || recPrecompute.sig !== sig) {
    if (!profile) profile = buildTasteProfile();
    recPrecompute = { sig, ranked: computeRecommendations(runtime.MOVIE_DB.length, profile), batches: [] };
    recRankingStale = false;
  }
  return recPrecompute;
}

function refreshStaleRanking() {
  if (!recRankingStale) return;
  recRankingStale = false;
  if (!recPrecompute || recPrecompute.ranked == null) return;
  const profile = buildTasteProfile();
  recPrecompute.ranked = computeRecommendations(runtime.MOVIE_DB.length, profile);
  recPrecompute.batches = [];
}

function precomputeRecBatches(count = 2) {
  const sig = recSignature();
  const profile = buildTasteProfile();
  const pc = ensurePrecompute(sig, profile);
  refreshStaleRanking();
  while (pc.batches.length < count) {
    const batch = nextRecBatch(pc.ranked, profile);
    if (!batch.length) break;
    pc.batches.push(batch);
  }
}

function schedulePrecompute() {
  const run = () => { try { precomputeRecBatches(2); } catch (e) { /* ignore */ } };
  if (typeof window !== 'undefined' && window.requestIdleCallback) {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 0);
  }
}

export function getRecommendations(options = {}) {
  const forceRefresh = !!options.forceRefresh;
  const sig = recSignature();
  if (forceRefresh || !recCache.list || recCache.list.length === 0) {
    const profile = buildTasteProfile();
    const pc = ensurePrecompute(sig, profile, forceRefresh);
    const list = pc.batches.length ? pc.batches.shift() : nextRecBatch(pc.ranked, profile);
    recCache = {
      sig,
      list,
      personalised: list.length > 0 && list[0].personalised,
      totalAvailable: pc.ranked.length,
    };
    schedulePrecompute();
  } else if (recCache.sig !== sig) {
    recRankingStale = true;
    recCache = { ...recCache, sig };
    schedulePrecompute();
  }
  return recCache;
}

// Append the next batch of recommendations onto the current visible list so the
// carousel scrolls "infinitely". Returns the updated cache; the list reference
// only changes when there are genuinely more picks to show, so callers can
// detect exhaustion by comparing list lengths.
export function appendRecommendations() {
  const sig = recSignature();
  if (!Array.isArray(recCache.list) || recCache.list.length === 0) {
    return getRecommendations({ forceRefresh: true });
  }
  const profile = buildTasteProfile();
  const pc = ensurePrecompute(sig, profile);
  refreshStaleRanking();
  const batch = pc.batches.length ? pc.batches.shift() : nextRecBatch(pc.ranked, profile);
  if (!batch.length) return recCache;
  recCache = {
    ...recCache,
    list: recCache.list.concat(batch),
    totalAvailable: pc.ranked.length,
  };
  schedulePrecompute();
  return recCache;
}

// Surgically swap a single actioned card (e.g. "Not Interested") out of the
// current visible batch for the next-best recommendation, leaving every other
// card untouched. Without this, the changed taste signal (which feeds
// recSignature) would invalidate the whole cache and reshuffle the carousel.
//
// Callers must apply the underlying signal (e.g. markNotInterested) *before*
// invoking this so the new signature is reflected when we re-stamp the cache.
export function replaceRecommendation(title) {
  const norm = normTitle(title);
  const list = recCache.list || [];
  const idx = list.findIndex((rec) => rec && normTitle(rec.movie.title) === norm);

  // Ensure we have a ranking to draw the replacement from.
  let pc = recPrecompute;
  if (!pc || pc.ranked == null) {
    pc = ensurePrecompute(recSignature(), null, true);
  }
  const ranked = pc.ranked || [];
  const newList = list.slice();

  if (idx >= 0) {
    // Titles still on screen must stay put — exclude them (and the actioned
    // title) so we never surface a duplicate or the just-dismissed movie.
    const visible = new Set();
    list.forEach((rec, i) => { if (i !== idx && rec) visible.add(normTitle(rec.movie.title)); });
    const seen = loadSeenRecommendations();
    const pick = (allowSeen) => ranked.find((rec) => {
      const nt = normTitle(rec.movie.title);
      if (nt === norm || visible.has(nt)) return false;
      return allowSeen || !seen.has(nt);
    });
    // Prefer a never-shown rec; fall back to any unshown-on-screen rec.
    const replacement = pick(false) || pick(true);
    if (replacement) {
      newList[idx] = replacement;
      seen.add(normTitle(replacement.movie.title));
      saveSeenRecommendations(seen);
    } else {
      // Nothing left to show — just drop the dismissed card.
      newList.splice(idx, 1);
    }
  }

  // Re-rank lazily on the next full refresh so the new signal fully propagates,
  // but keep the surgically-updated list under the CURRENT signature so the
  // imminent re-render serves it from cache instead of rebuilding the batch.
  recRankingStale = true;
  recCache = {
    sig: recSignature(),
    list: newList,
    personalised: newList.length > 0 && newList[0].personalised,
    totalAvailable: recCache.totalAvailable || ranked.length,
  };
  return recCache;
}

// Recommendation-data status used by the carousel's small status indicator.
export function recommendationDataStatus() {
  if (runtime.movieDbStatus === 'error') {
    return { level: 'error', message: `Recommendations unavailable: couldn't load movies (${runtime.movieDbError || 'unknown error'}).` };
  }
  if (runtime.movieDbStatus === 'loading') {
    return { level: 'loading', message: 'Loading recommendation movies…' };
  }
  if (runtime.embeddingsStatus === 'error') {
    return { level: 'error', message: `Embeddings unavailable: couldn't load recommendation vectors (${runtime.embeddingsError || 'unknown error'}).` };
  }
  if (runtime.embeddingsStatus === 'loading') {
    return { level: 'loading', message: 'Loading recommendation vectors…' };
  }
  return null;
}
