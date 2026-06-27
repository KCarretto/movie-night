// ======================================================================
//  LOCAL PERSISTENCE — names, vote history, watched/watchlist + signals
// ======================================================================
// All of these live in localStorage / sessionStorage and never leave this
// browser, except that watched titles + ratings are shared with the room. The
// mutators here are intentionally side-effect free (pure storage): the room
// controller is responsible for re-sharing taste / re-rendering after a change.

import { normTitle } from './format.js';
import { cleanName } from './constants.js';

// ---- Persistence of the participant's chosen name --------------------------
const NAME_STORAGE_KEY = 'movieNightName';
export function loadSavedName() {
  try { return cleanName(localStorage.getItem(NAME_STORAGE_KEY) || ''); }
  catch (e) { return ''; }
}
export function saveName(name) {
  try {
    if (name) localStorage.setItem(NAME_STORAGE_KEY, name);
    else localStorage.removeItem(NAME_STORAGE_KEY);
  } catch (e) { /* storage may be unavailable */ }
}

// ---- Host-resume persistence (per tab) so a host can refresh the page ------
const HOST_ROOM_KEY = 'movieNightHostRoom';
const REC_SESSION_SEEN_KEY = 'movieNightRecSeen';
export function rememberHostRoom(id) {
  try { sessionStorage.setItem(HOST_ROOM_KEY, id); } catch (e) { /* ignore */ }
}
export function recallHostRoom() {
  try { return sessionStorage.getItem(HOST_ROOM_KEY) || ''; }
  catch (e) { return ''; }
}
export function loadSeenRecommendations() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(REC_SESSION_SEEN_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(normTitle).filter(Boolean) : []);
  } catch (e) {
    return new Set();
  }
}
export function saveSeenRecommendations(seenSet) {
  try { sessionStorage.setItem(REC_SESSION_SEEN_KEY, JSON.stringify([...seenSet])); }
  catch (e) { /* ignore */ }
}

// ---- Recently Nominated: [title] --------------------------------------------
export function loadRecentlyNominated() { const v = loadJson(RECENTLY_NOMINATED_KEY, []); return Array.isArray(v) ? v : []; }
export function addRecentlyNominated(title) {
  const clean = String(title || '').trim();
  if (!clean) return;
  let list = loadRecentlyNominated();
  list = list.filter((t) => normTitle(t) !== normTitle(clean));
  list.unshift(clean);
  if (list.length > 20) list = list.slice(0, 20);
  saveJson(RECENTLY_NOMINATED_KEY, list);
}

// ---- Generic JSON store helpers --------------------------------------------
const RECENTLY_NOMINATED_KEY = 'movieNightRecentlyNominated';
const HISTORY_KEY = 'movieNightHistory';
const WATCHED_KEY = 'movieNightWatched';
const WATCHLIST_KEY = 'movieNightWatchlist';
const INTERESTED_KEY = 'movieNightInterested';
const NOT_INTERESTED_KEY = 'movieNightNotInterested';
const NOT_SURE_KEY = 'movieNightNotSure';

export function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
  catch (e) { return fallback; }
}
export function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* full/unavailable */ }
}

// ---- Movie-night vote history ----------------------------------------------
export function loadHistory() { const v = loadJson(HISTORY_KEY, []); return Array.isArray(v) ? v : []; }
export function saveHistory(list) { saveJson(HISTORY_KEY, list); }

// ---- Watched list: [{ title, rating (0-5, 0 = unrated), watchedAt }] -------
export function loadWatched() { const v = loadJson(WATCHED_KEY, []); return Array.isArray(v) ? v : []; }
export function saveWatched(list) { saveJson(WATCHED_KEY, list); }
export function findWatched(title) { return loadWatched().find((w) => normTitle(w.title) === normTitle(title)); }

// Add or update a watched movie (and its rating). Pure persistence: the caller
// re-shares taste afterwards.
export function upsertWatched(title, rating) {
  const clean = String(title || '').trim();
  if (!clean) return;
  const list = loadWatched();
  const existing = list.find((w) => normTitle(w.title) === normTitle(clean));
  if (existing) {
    if (rating != null) existing.rating = rating;
  } else {
    list.push({ title: clean, rating: rating || 0, watchedAt: Date.now() });
  }
  saveWatched(list);
}

// Snapshot of my watched movies shared with the room as { title, rating }.
export function mySeenShare() {
  return loadWatched().map((w) => ({ title: w.title, rating: w.rating || 0 }));
}

// ---- Watchlist: [{ title, addedAt }] ---------------------------------------
export function loadWatchlist() { const v = loadJson(WATCHLIST_KEY, []); return Array.isArray(v) ? v : []; }
export function saveWatchlist(list) { saveJson(WATCHLIST_KEY, list); }
export function inWatchlist(title) {
  return loadWatchlist().some((w) => normTitle(w.title) === normTitle(title));
}
export function addToWatchlist(title) {
  const clean = String(title || '').trim();
  if (!clean) return;
  const list = loadWatchlist();
  if (list.some((w) => normTitle(w.title) === normTitle(clean))) return;
  list.push({ title: clean, addedAt: Date.now() });
  saveWatchlist(list);
}
export function removeFromWatchlist(title) {
  saveWatchlist(loadWatchlist().filter((w) => normTitle(w.title) !== normTitle(title)));
}

// ---- Interested: [{ title, interest (1-5), at }] ---------------------------
export function loadInterested() { const v = loadJson(INTERESTED_KEY, []); return Array.isArray(v) ? v : []; }
export function saveInterested(list) { saveJson(INTERESTED_KEY, list); }
export function upsertInterested(title, interest) {
  const clean = String(title || '').trim();
  if (!clean) return;
  const list = loadInterested();
  const existing = list.find((w) => normTitle(w.title) === normTitle(clean));
  if (existing) existing.interest = interest;
  else list.push({ title: clean, interest: interest || 0, at: Date.now() });
  saveInterested(list);
}

// ---- Not interested: [{ title, at }] ---------------------------------------
export function loadNotInterested() { const v = loadJson(NOT_INTERESTED_KEY, []); return Array.isArray(v) ? v : []; }
export function saveNotInterested(list) { saveJson(NOT_INTERESTED_KEY, list); }
export function markNotInterested(title) {
  const clean = String(title || '').trim();
  if (!clean) return;
  const list = loadNotInterested();
  if (!list.some((w) => normTitle(w.title) === normTitle(clean))) {
    list.push({ title: clean, at: Date.now() });
    saveNotInterested(list);
  }
}

// ---- I'm not sure: [{ title, at }] (hides from the training flow only) ------
export function loadNotSure() { const v = loadJson(NOT_SURE_KEY, []); return Array.isArray(v) ? v : []; }
export function saveNotSure(list) { saveJson(NOT_SURE_KEY, list); }
export function markNotSure(title) {
  const clean = String(title || '').trim();
  if (!clean) return;
  const list = loadNotSure();
  if (!list.some((w) => normTitle(w.title) === normTitle(clean))) {
    list.push({ title: clean, at: Date.now() });
    saveNotSure(list);
  }
}
