// ======================================================================
//  LOCAL ML RECOMMENDATION ENGINE (Precomputed HDBSCAN version)
// ======================================================================

import { runtime } from './runtime.js';
import { movieMeta } from './catalog.js';
import { normTitle } from './format.js';
import {
  loadWatched, loadWatchlist, loadInterested, loadNotInterested, loadHistory,
  loadSeenRecommendations, saveSeenRecommendations,
} from './storage.js';

export const REC_CONFIG = {
  maxResults: 18,
  newSinceYear: new Date().getFullYear() - 2,
  newFraction: 0.35,
  watchlistInjectFraction: 0.15,
};

export const isNewMovie = (m) => !!(m && m.year && m.year >= REC_CONFIG.newSinceYear);

export function computeMyCentroids() { return []; }
export function myTasteVector() { return []; }
export function buildTasteProfile() { return buildLocalProfile(); }

// Build the local user's network profile representation
export function buildLocalProfile() {
  const liked = new Set();
  const watchlist = new Set();
  const dislikeIds = new Set();
  const dislikeGenres = new Set();
  const dislikeDirectors = new Set();
  
  const watched = loadWatched();
  watched.forEach(w => {
    const meta = movieMeta(w.title);
    if (!meta) return;
    const r = w.rating || 0;
    if (r >= 4.0) {
      liked.add(String(meta.id));
    } else if (r > 0 && r <= 2.0) {
      dislikeIds.add(String(meta.id));
      (meta.genres || []).forEach(g => dislikeGenres.add(g));
      if (meta.director) {
        if (Array.isArray(meta.director)) {
          meta.director.forEach(d => dislikeDirectors.add(d));
        } else {
          dislikeDirectors.add(meta.director);
        }
      }
    }
  });

  const wl = loadWatchlist();
  wl.forEach(w => {
    const meta = movieMeta(w.title);
    if (meta) {
      watchlist.add(String(meta.id));
    }
  });

  const ni = loadNotInterested();
  ni.forEach(w => {
    const meta = movieMeta(w.title);
    if (meta) {
      dislikeIds.add(String(meta.id));
      (meta.genres || []).forEach(g => dislikeGenres.add(g));
      if (meta.director) {
        if (Array.isArray(meta.director)) {
          meta.director.forEach(d => dislikeDirectors.add(d));
        } else {
          dislikeDirectors.add(meta.director);
        }
      }
    }
  });

  // Calculate genre weights (frequency counts in liked & watchlist)
  const genreCounts = {};
  liked.forEach(id => {
    const meta = movieMeta(null, Number(id));
    if (meta) {
      (meta.genres || []).forEach(g => {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    }
  });
  watchlist.forEach(id => {
    const meta = movieMeta(null, Number(id));
    if (meta) {
      (meta.genres || []).forEach(g => {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
    }
  });
  const genreWeights = Object.entries(genreCounts).map(([genre, weight]) => ({
    genre,
    weight
  }));

  // Preferred directors (from liked & watchlist)
  const directors = new Set();
  liked.forEach(id => {
    const meta = movieMeta(null, Number(id));
    if (meta && meta.director) {
      if (Array.isArray(meta.director)) {
        meta.director.forEach(d => directors.add(d));
      } else {
        directors.add(meta.director);
      }
    }
  });
  watchlist.forEach(id => {
    const meta = movieMeta(null, Number(id));
    if (meta && meta.director) {
      if (Array.isArray(meta.director)) {
        meta.director.forEach(d => directors.add(d));
      } else {
        directors.add(meta.director);
      }
    }
  });
  const preferredDirectors = [...directors];

  // Preferred actors (first 4 cast members of liked & watchlist)
  const actors = new Set();
  liked.forEach(id => {
    const meta = movieMeta(null, Number(id));
    if (meta && meta.cast) {
      meta.cast.slice(0, 4).forEach(a => actors.add(a));
    }
  });
  watchlist.forEach(id => {
    const meta = movieMeta(null, Number(id));
    if (meta && meta.cast) {
      meta.cast.slice(0, 4).forEach(a => actors.add(a));
    }
  });
  const preferredActors = [...actors];

  return {
    userId: runtime.myId || 'local',
    likedMovieIds: [...liked],
    watchlistMovieIds: [...watchlist],
    dislikeMovieIds: [...dislikeIds],
    dislikeGenres: [...dislikeGenres],
    dislikeDirectors: [...dislikeDirectors],
    genreWeights,
    preferredDirectors,
    preferredActors
  };
}

// Generate the evaluation candidate pool of ~500 movies
export function getCandidates(activeMembers) {
  if (!runtime.recommendationManifest || !runtime.recommendationManifest.movies) {
    return [];
  }
  
  const manifestMovies = runtime.recommendationManifest.movies;
  const candidateIds = new Set();
  
  // 1. Add group's watchlists
  activeMembers.forEach(member => {
    (member.watchlistMovieIds || []).forEach(id => {
      if (manifestMovies[id]) {
        candidateIds.add(id);
      }
    });
  });
  
  // 2. Add Top-50 nearest semantic neighbors of all liked movies
  activeMembers.forEach(member => {
    (member.likedMovieIds || []).forEach(id => {
      const m = manifestMovies[id];
      if (m && m.topNeighbors) {
        Object.keys(m.topNeighbors).forEach(neighborId => {
          if (manifestMovies[neighborId]) {
            candidateIds.add(neighborId);
          }
        });
      }
    });
  });

  // 3. Add movies belonging to the same HDBSCAN clusters as liked movies
  const likedClusters = new Set();
  activeMembers.forEach(member => {
    (member.likedMovieIds || []).forEach(id => {
      const m = manifestMovies[id];
      if (m && m.clusterId !== undefined && m.clusterId !== -1) {
        likedClusters.add(m.clusterId);
      }
    });
  });

  const allMoviesList = Object.entries(manifestMovies).map(([id, m]) => ({
    id,
    title: m.title,
    clusterId: m.clusterId,
    director: m.director,
    genres: m.genres || [],
    criticalScore: m.criticalScore || 0,
    topNeighbors: m.topNeighbors || {}
  }));

  if (likedClusters.size > 0) {
    const clusterMovies = allMoviesList.filter(m => 
      m.clusterId !== undefined && likedClusters.has(m.clusterId)
    );
    // Sort by critical score so we get the best of these clusters
    clusterMovies.sort((a, b) => b.criticalScore - a.criticalScore);
    for (const m of clusterMovies) {
      if (candidateIds.size >= 400) break;
      candidateIds.add(m.id);
    }
  }

  // 4. Find dominant genres for the group
  const groupGenreWeights = {};
  activeMembers.forEach(member => {
    (member.genreWeights || []).forEach(gw => {
      groupGenreWeights[gw.genre] = (groupGenreWeights[gw.genre] || 0) + gw.weight;
    });
  });
  const sortedGenres = Object.entries(groupGenreWeights)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);
  const dominantGenres = new Set(sortedGenres.slice(0, 3)); // top 3 genres
  
  // Add movies from dominant genres
  if (dominantGenres.size > 0) {
    const genreMovies = allMoviesList.filter(m => 
      (m.genres || []).some(g => dominantGenres.has(g))
    );
    genreMovies.sort((a, b) => b.criticalScore - a.criticalScore);
    for (const m of genreMovies) {
      if (candidateIds.size >= 500) break;
      candidateIds.add(m.id);
    }
  }
  
  // 5. Add high critical score movies to fill the pool up to 600
  allMoviesList.sort((a, b) => b.criticalScore - a.criticalScore);
  for (const m of allMoviesList) {
    if (candidateIds.size >= 600) break;
    candidateIds.add(m.id);
  }
  
  // Convert to candidate objects
  let candidates = [...candidateIds].map(id => {
    const m = manifestMovies[id];
    if (!m) return null;
    return {
      id,
      title: m.title,
      clusterId: m.clusterId,
      director: m.director,
      genres: m.genres || [],
      criticalScore: m.criticalScore || 0,
      topNeighbors: m.topNeighbors || {}
    };
  }).filter(Boolean);
  
  // Apply Guardrails
  const filteredList = [];
  const keptList = [];
  candidates.forEach(m => {
    let blockedReason = null;
    for (const member of activeMembers) {
      const dislikeIds = new Set(member.dislikeMovieIds || []);
      if (dislikeIds.has(m.id)) {
        blockedReason = `${member.userId === runtime.myId ? 'You' : (member.name || member.userId || 'A peer')} disliked this movie or marked it 'Not Interested'`;
        break;
      }
    }
    if (blockedReason) {
      filteredList.push({ id: m.id, title: m.title, reason: blockedReason });
    } else {
      keptList.push(m);
    }
  });
  
  runtime.guardrailsFiltered = filteredList;
  candidates = keptList;
  
  return candidates;
}

// Blend algorithm for tray variations and new/old movies
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

// Score recommendations using the precomputed manifest maps
export function computeRecommendations(maxResults = REC_CONFIG.maxResults, profile = null) {
  if (!runtime.MOVIE_DB.length || !runtime.recommendationManifest) return [];
  
  const activeMembers = [];
  activeMembers.push(buildLocalProfile());
  
  const peers = (runtime.state && runtime.state.peers) || [];
  const activePeers = peers.filter(p => p.connected !== false);
  const peerProfiles = runtime.peerProfiles || {};
  
  activePeers.forEach(p => {
    if (p.id !== runtime.myId && peerProfiles[p.id]) {
      activeMembers.push(peerProfiles[p.id]);
    }
  });

  const candidates = getCandidates(activeMembers);
  
  const activeGenres = runtime.activeSelectedGenres;
  const activeLangs = runtime.activeSelectedLanguages;
  
  const seenSet = roomSeenTitles();
  const nominatedSet = new Set((runtime.state?.movies || []).map((m) => normTitle(m.title)));
  const skipSet = new Set(loadNotInterested().map((x) => normTitle(x.title)));
  const watchlistSet = new Set(loadWatchlist().map((x) => normTitle(x.title)));
  
  const scoredCandidates = [];
  
  for (const m of candidates) {
    const movieObj = movieMeta(m.title, Number(m.id));
    if (!movieObj || !movieObj.art) continue;
    
    if (activeGenres.length > 0) {
      const genreMatch = (movieObj.genres || []).some((g) => activeGenres.includes(g));
      if (!genreMatch) continue;
    }
    if (activeLangs.length > 0) {
      if (!activeLangs.includes(movieObj.language)) continue;
    }
    
    const nt = normTitle(movieObj.title);
    if (seenSet.has(nt) || nominatedSet.has(nt) || skipSet.has(nt)) continue;
    
    // O(1) loop scoring per group member
    const userScores = activeMembers.map(member => {
      // 1. Plot Similarity (Max Similarity Rule)
      let simPlot = 0;
      if (m.topNeighbors && member.likedMovieIds) {
        member.likedMovieIds.forEach(likedId => {
          const score = m.topNeighbors[likedId];
          if (score !== undefined && score > simPlot) {
            simPlot = score;
          }
        });
      }
      
      // 2. Genre Similarity (Jaccard Coefficient)
      const genreMap = {};
      (member.genreWeights || []).forEach(gw => {
        genreMap[gw.genre] = gw.weight;
      });
      const userGenreSet = new Set(Object.keys(genreMap));
      const movieGenreSet = new Set(movieObj.genres || []);
      const intersection = new Set([...movieGenreSet].filter(x => userGenreSet.has(x)));
      const union = new Set([...movieGenreSet, ...userGenreSet]);
      const simGenre = union.size > 0 ? intersection.size / union.size : 0;
      
      // 3. Critical Score
      const scoreCritical = m.criticalScore || 0;
      
      // 4. Metadata Bonuses
      const directorSet = new Set(member.preferredDirectors || []);
      const actorSet = new Set(member.preferredActors || []);
      const memberWatchlistSet = new Set(member.watchlistMovieIds || []);
      
      let bonusDirector = 0;
      if (movieObj.director) {
        if (Array.isArray(movieObj.director)) {
          if (movieObj.director.some(d => directorSet.has(d))) bonusDirector = 0.15;
        } else if (directorSet.has(movieObj.director)) {
          bonusDirector = 0.15;
        }
      }
      
      let bonusActor = 0;
      if (movieObj.cast && Array.isArray(movieObj.cast)) {
        if (movieObj.cast.some(a => actorSet.has(a))) bonusActor = 0.15;
      }
      
      const bonusWatchlist = memberWatchlistSet.has(String(movieObj.id)) ? 0.12 : 0;
      
      // 5. Metadata Soft Penalties
      let penaltyDislike = 0;
      const memberDislikeGenres = new Set(member.dislikeGenres || []);
      const memberDislikeDirectors = new Set(member.dislikeDirectors || []);
      
      if (movieObj.genres && movieObj.genres.some(g => memberDislikeGenres.has(g))) {
        penaltyDislike += 0.25;
      }
      
      if (movieObj.director) {
        if (Array.isArray(movieObj.director)) {
          if (movieObj.director.some(d => memberDislikeDirectors.has(d))) penaltyDislike += 0.25;
        } else if (memberDislikeDirectors.has(movieObj.director)) {
          penaltyDislike += 0.25;
        }
      }
      
      const w1 = 0.15, w2 = 0.45, w3 = 0.40;
      return (w1 * simPlot) + (w2 * simGenre) + (w3 * scoreCritical) + bonusDirector + bonusActor + bonusWatchlist - penaltyDislike;
    });
    
    // Group hybrid aggregation: 0.70 * Mean + 0.30 * Min
    const sum = userScores.reduce((a, b) => a + b, 0);
    const mean = userScores.length > 0 ? sum / userScores.length : 0;
    const min = userScores.length > 0 ? Math.min(...userScores) : 0;
    const groupScore = 0.70 * mean + 0.30 * min;
    
    const onWatchlist = watchlistSet.has(nt);
    scoredCandidates.push({
      movie: movieObj,
      score: groupScore,
      isNew: isNewMovie(movieObj),
      personalised: activeMembers.some(member => (member.likedMovieIds || []).length > 0),
      fromWatchlist: onWatchlist
    });
  }
  
  scoredCandidates.sort((a, b) => b.score - a.score);
  return blendRecommendations(scoredCandidates, maxResults);
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
  
  // Signature of peer profiles
  const profiles = runtime.peerProfiles || {};
  const profilesSig = Object.keys(profiles).sort().map(uid => {
    const p = profiles[uid];
    return uid + ':' + (p.likedMovieIds || []).length + ':' + (p.watchlistMovieIds || []).length;
  }).join('|');

  const embReady = runtime.recommendationManifest ? '1' : '0';
  const filt = runtime.activeSelectedGenres.join(',') + '/' + runtime.activeSelectedLanguages.join(',');
  return runtime.MOVIE_DB.length + '#' + hist
       + '#' + intr + '#' + ni + '#' + watched
       + '#' + seenSig + '#' + profilesSig + '#' + embReady + '#' + filt;
}

function nextRecBatch(ranked) {
  let seen = loadSeenRecommendations();
  let unseen = ranked.filter((rec) => !seen.has(normTitle(rec.movie.title)));
  
  if (unseen.length === 0 && ranked.length > 0) {
    seen.clear();
    saveSeenRecommendations(seen);
    unseen = ranked;
  }
  
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

function ensurePrecompute(sig, forceRecompute = false) {
  if (forceRecompute || recPrecompute.sig !== sig) {
    recPrecompute = { sig, ranked: computeRecommendations(runtime.MOVIE_DB.length), batches: [] };
    recRankingStale = false;
  }
  return recPrecompute;
}

function refreshStaleRanking() {
  if (!recRankingStale) return;
  recRankingStale = false;
  if (!recPrecompute || recPrecompute.ranked == null) return;
  recPrecompute.ranked = computeRecommendations(runtime.MOVIE_DB.length);
  recPrecompute.batches = [];
}

function precomputeRecBatches(count = 2) {
  const sig = recSignature();
  const pc = ensurePrecompute(sig);
  refreshStaleRanking();
  while (pc.batches.length < count) {
    const batch = nextRecBatch(pc.ranked);
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
    const pc = ensurePrecompute(sig, forceRefresh);
    const list = pc.batches.length ? pc.batches.shift() : nextRecBatch(pc.ranked);
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

export function appendRecommendations() {
  const sig = recSignature();
  if (!Array.isArray(recCache.list) || recCache.list.length === 0) {
    return getRecommendations({ forceRefresh: true });
  }
  const pc = ensurePrecompute(sig);
  refreshStaleRanking();
  const batch = pc.batches.length ? pc.batches.shift() : nextRecBatch(pc.ranked);
  if (!batch.length) return recCache;
  recCache = {
    ...recCache,
    list: recCache.list.concat(batch),
    totalAvailable: pc.ranked.length,
  };
  schedulePrecompute();
  return recCache;
}

export function replaceRecommendation(title) {
  const norm = normTitle(title);
  const list = recCache.list || [];
  const idx = list.findIndex((rec) => rec && normTitle(rec.movie.title) === norm);

  let pc = recPrecompute;
  if (!pc || pc.ranked == null) {
    pc = ensurePrecompute(recSignature(), true);
  }
  const ranked = pc.ranked || [];
  const newList = list.slice();

  if (idx >= 0) {
    const visible = new Set();
    list.forEach((rec, i) => { if (i !== idx && rec) visible.add(normTitle(rec.movie.title)); });
    const seen = loadSeenRecommendations();
    const pick = (allowSeen) => ranked.find((rec) => {
      const nt = normTitle(rec.movie.title);
      if (nt === norm || visible.has(nt)) return false;
      return allowSeen || !seen.has(nt);
    });
    const replacement = pick(false) || pick(true);
    if (replacement) {
      newList[idx] = replacement;
      seen.add(normTitle(replacement.movie.title));
      saveSeenRecommendations(seen);
    } else {
      newList.splice(idx, 1);
    }
  }

  recRankingStale = true;
  recCache = {
    sig: recSignature(),
    list: newList,
    personalised: newList.length > 0 && newList[0].personalised,
    totalAvailable: recCache.totalAvailable || ranked.length,
  };
  return recCache;
}

export function recommendationDataStatus() {
  if (runtime.movieDbStatus === 'error') {
    return { level: 'error', message: `Recommendations unavailable: couldn't load movies (${runtime.movieDbError || 'unknown error'}).` };
  }
  if (runtime.movieDbStatus === 'loading') {
    return { level: 'loading', message: 'Loading recommendation movies…' };
  }
  if (runtime.recommendationStatus === 'error') {
    return { level: 'error', message: `Recommendations unavailable: couldn't load manifest (${runtime.recommendationError || 'unknown error'}).` };
  }
  if (runtime.recommendationStatus === 'loading') {
    return { level: 'loading', message: 'Loading recommendation manifest…' };
  }
  return null;
}
