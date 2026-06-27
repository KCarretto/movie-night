Ah! Wait. If `seenSig` or `pvSig` change, `recSignature` changes.
If `recSignature` changes, `appendRecommendations` returns `getRecommendations()`, which returns a BRAND NEW LIST!
Wait! "don't refresh everyone's recommendations any time someone nominates a film etc".
Maybe they mean "any time someone does something in the room, my recommendations jump to the beginning because of a full refresh"?
Yes! `pvSig` changes when they send their taste (e.g. rate a movie, watchlist a movie).
`seenSig` changes when they watch a movie.
In the room, people are constantly rating and watchlisting movies!
EVERY TIME they do, `afterTasteChange()` broadcasts the new vector.
EVERY TIME the vector is received, `recSignature` changes.
EVERY TIME `recSignature` changes, the next render of `<Recommendations />` calls `getRecommendations()`.
Wait! `Recommendations.jsx` has:
```javascript
  const recs = embeddingsPending ? { list: [], personalised: false, totalAvailable: 0 } : getRecommendations();
```
It calls `getRecommendations()` on EVERY render!
If `recSignature()` has changed, `getRecommendations()` will return a NEW batch, COMPLETELY REPLACING THE CURRENT CAROUSEL!
So if user A scrolls down 50 items and is looking at a movie, and user B likes a movie (which changes their taste vector), user A's screen suddenly resets to the beginning with a completely new set of movies!
This is a HORRIBLE experience!

So how to fix it?
We want recommendations to be "surgically replaced" or re-ranked *lazily* without jumping the carousel!
Wait! The code already HAS a mechanism for lazy re-ranking!
In `replaceRecommendation`:
```javascript
  // Re-rank lazily on the next full refresh so the new signal fully propagates,
  // but keep the surgically-updated list under the CURRENT signature so the
  // imminent re-render serves it from cache instead of rebuilding the batch.
  recRankingStale = true;
  recCache = {
    sig: recSignature(),
    list: newList,
    ...
```
Wait! If `getRecommendations()` is called on render, and `sig` has changed, it does a full refresh.
If we want to AVOID full refreshes when the ROOM'S state changes, we need to decouple the "visible list" from the "background signature".
If the user's OWN taste changes (e.g. they rate a movie, add to watchlist), do they want their list to refresh immediately?
Even if their OWN taste changes, if they use `onWatchlist`, it doesn't call `replaceRecommendation`, it calls `afterTasteChange`. Wait, `onWatchlist` calls `afterTasteChange()`.
But wait! `onNotInterested` calls `replaceRecommendation`.
So for `onNotInterested`, the carousel doesn't jump.
But for `onWatchlist`, it calls `afterTasteChange()`, which updates `pvSig`, which changes `recSignature()`, which causes the carousel to JUMP!
If they just rate a movie (`onWatched` -> rate), it calls `upsertWatched` and `shareSeen()`, which changes `recSignature()`, which causes the carousel to JUMP!
If someone ELSE changes their taste, it causes a JUMP!

So what if we change `getRecommendations()` to ONLY do a full refresh if `forceRefresh` is true, or if it's the FIRST load?
Wait! If `getRecommendations()` never refreshes automatically, how do recommendations get better?
When they scroll right (`appendRecommendations`), it computes the NEXT batch. If `recRankingStale` is true, it re-ranks in the background, and the NEXT batch uses the NEW ranking!
BUT wait! If `recSignature` changes, `appendRecommendations` currently does a full refresh!
```javascript
export function appendRecommendations() {
  const sig = recSignature();
  if (recCache.sig !== sig || !Array.isArray(recCache.list)) {
    return getRecommendations();
  }
```
If we change `getRecommendations` to just update the cache's signature but keep the list:
If we want to "Re-rank lazily", we should mark it stale, and let `appendRecommendations` use the new ranking.
But what if the signature changes?
If we don't automatically refresh, we should just update `recCache.sig` to the new signature, set `recRankingStale = true`, and return the SAME list!
Wait, if we do that, the carousel NEVER jumps back to the start unless `forceRefresh` is clicked!
Is that what they want? Yes: "don't refresh everyone's recommendations any time someone nominates a film etc".

Let's modify `getRecommendations`:
```javascript
export function getRecommendations(options = {}) {
  const forceRefresh = !!options.forceRefresh;
  const sig = recSignature();

  if (forceRefresh || !recCache.list || recCache.list.length === 0) {
    // DO FULL REFRESH
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
    // LAZY REFRESH: don't clear the list, just mark stale so the next batch uses the new ranking
    recRankingStale = true;
    recCache = {
      ...recCache,
      sig, // adopt the new signature so we don't keep triggering this
    };
    schedulePrecompute(); // precompute the NEXT batch in the background using the new sig
  }

  return recCache;
}
```
Wait, if they change the FILTERS (genre, language), they WANT a full refresh!
Because if they filter by "Action", the current list might have "Comedy", which shouldn't be there anymore.
How do filters trigger a full refresh?
In `Recommendations.jsx`:
```javascript
  const applyFilterChange = () => {
    markRankingStale();
    getRecommendations({ forceRefresh: true });
    emit();
  };
```
Ah! They pass `{ forceRefresh: true }`!
So my proposed change to `getRecommendations` works perfectly! If `forceRefresh` is true, it does a full refresh. If `recCache.sig !== sig` but `forceRefresh` is false, it just updates the signature, sets `recRankingStale = true`, and keeps the current list!
Wait! What if `appendRecommendations` is called?
```javascript
export function appendRecommendations() {
  const sig = recSignature();
  // We no longer need to do a full refresh if sig differs, because getRecommendations will handle it lazily.
  // Actually, appendRecommendations will just append.
```
Wait, `appendRecommendations` does:
```javascript
  const sig = recSignature();
  if (!Array.isArray(recCache.list)) {
    return getRecommendations({ forceRefresh: true });
  }
  const profile = buildTasteProfile();
  const pc = ensurePrecompute(sig, profile);
  refreshStaleRanking(); // this recomputes the ranking if stale!
  const batch = pc.batches.length ? pc.batches.shift() : nextRecBatch(pc.ranked, profile);
```
So if `recCache.sig !== sig` was checked in `appendRecommendations`, it would do a full refresh!
If we change `appendRecommendations` to:
```javascript
export function appendRecommendations() {
  const sig = recSignature();
  if (!Array.isArray(recCache.list) || recCache.list.length === 0) {
    return getRecommendations({ forceRefresh: true });
  }

  // ensurePrecompute will see a new sig if it hasn't been updated, or if it has, it will use it.
  const profile = buildTasteProfile();
  const pc = ensurePrecompute(sig, profile);
  refreshStaleRanking();
  const batch = pc.batches.length ? pc.batches.shift() : nextRecBatch(pc.ranked, profile);
  if (!batch.length) return recCache;
  recCache = {
    ...recCache,
    sig,
    list: recCache.list.concat(batch),
    totalAvailable: pc.ranked.length,
  };
  schedulePrecompute();
  return recCache;
}
```
Wait, `appendRecommendations` was:
```javascript
export function appendRecommendations() {
  const sig = recSignature();
  if (recCache.sig !== sig || !Array.isArray(recCache.list)) {
    return getRecommendations();
  }
  ...
```
If we remove `recCache.sig !== sig` from `appendRecommendations`, it will just append!
Wait! Does `replaceRecommendation` do the same thing?
```javascript
export function replaceRecommendation(title) {
  ...
  recRankingStale = true;
  recCache = {
    sig: recSignature(),
    list: newList,
    personalised: newList.length > 0 && newList[0].personalised,
    totalAvailable: recCache.totalAvailable || ranked.length,
  };
  return recCache;
}
```
Yes, `replaceRecommendation` just updates `sig` and keeps `newList`.

So the fix is to change `getRecommendations` and `appendRecommendations` to NOT clear the list when the signature changes, unless `forceRefresh` is true!
