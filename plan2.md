Wait, if `recSignature()` DOES NOT contain `runtime.state.movies.length`, then how does a nomination trigger a refresh?
Oh, I see: "don't refresh everyone's recommendations any time someone nominates a film etc".
Wait, does it currently refresh?!
Let's see: `ensurePrecompute` uses `recSignature()`.
If `recSignature()` doesn't change, `ensurePrecompute` returns `recPrecompute`.
In `getRecommendations`:
```javascript
  if (forceRefresh || recCache.sig !== sig) {
    const pc = ensurePrecompute(sig, profile, forceRefresh);
    const list = pc.batches.length ? pc.batches.shift() : nextRecBatch(pc.ranked, profile);
    recCache = {
      sig,
      list,
      personalised: list.length > 0 && list[0].personalised,
      totalAvailable: pc.ranked.length,
    };
    schedulePrecompute();
  }
  return recCache;
```
If `sig` hasn't changed, `getRecommendations()` just returns `recCache`.
So `getRecommendations()` won't change the list.
BUT wait, what about `computeRecommendations`?
```javascript
const nominatedSet = new Set(runtime.state.movies.map((m) => normTitle(m.title)));
```
Ah! `computeRecommendations` filters out nominated movies (`nominatedSet.has(nt)`).
Since `computeRecommendations` depends on `runtime.state.movies`, IF `computeRecommendations` is called, it will filter out the nominated movie.
But WHEN is `computeRecommendations` called?
Only when `ensurePrecompute` sees a new `sig` or `forceRefresh` is true.
Since `sig` does NOT change when someone nominates a film, `ensurePrecompute` is NOT triggered, so `computeRecommendations` is NOT called!
So recommendations are NOT refreshed when someone nominates a film!
Wait, but if they are NOT refreshed, then the nominated film might still appear in the recommendations!
Yes! And the user says: "don't refresh everyone's recommendations any time someone nominates a film etc".
Wait. They want it to NOT refresh. "don't refresh everyone's recommendations any time someone nominates a film etc".
Does it currently refresh?
Let's check where `forceRefresh` is used.
```javascript
  const onNominate = (m) => {
    actions.nominate(m.title, m.id || m.tmdbId);
    replaceRecommendation(m.title);
    emit();
  };
```
Ah! `replaceRecommendation(m.title)`!
```javascript
export function replaceRecommendation(title) {
  const norm = normTitle(title);
  const list = recCache.list || [];
  const idx = list.findIndex((rec) => rec && normTitle(rec.movie.title) === norm);

  // Ensure we have a ranking to draw the replacement from.
  let pc = recPrecompute;
  if (!pc || pc.ranked == null) {
    pc = ensurePrecompute(recSignature(), null, true);
  }
  ...
```
This just replaces ONE recommendation.
So where is the "refresh everyone's recommendations" coming from?!
Ah!
When SOMEONE ELSE nominates a film, `actions.nominate` is dispatched.
`controller.js` `applyAction`:
```javascript
      state.movies.push(...);
```
Wait! Does `recSignature` include `state.movies.length`?
Let's look at `recSignature`:
```javascript
  const seenSig = Object.keys(seen).filter((pid) => pid !== runtime.myId).sort().map((pid) =>
    pid + ':' + (Array.isArray(seen[pid]) ? seen[pid].length : 0)).join('|');
  const pv = (runtime.state && runtime.state.peerVectors) || {};
  const pvSig = Object.keys(pv).sort().join('|');
```
Wait, if someone joins, `pvSig` or `seenSig` doesn't change until they send their vectors.
When they send their vectors, `pvSig` and `seenSig` DO change!
Then `recSignature` changes!
Then everyone's recommendations refresh!
So when a new guest joins and sends their taste, `recSignature` changes, and the whole list refreshes.
Is that what they mean by "etc"? "any time someone nominates a film etc"?
Let's check if there's something else.
Look at `controller.js` `applyAction`:
```javascript
  switch (action.type) {
    case 'nominate': ...
    case 'removeNomination': ...
    case 'startVoting': ...
    case 'cancelVoting': ...
    case 'vote': ...
    case 'closeVoting': ...
    case 'reset': ...
    case 'setName': ...
    case 'setSeen': ...
    case 'setVector': ...
```
What if `state` is re-assigned?
```javascript
function applyRemoteState(remote) {
  ...
  runtime.state = remote;
  ...
}
```
Ah! Wait. "don't refresh everyone's recommendations any time someone nominates a film etc"
Let me look at `Recommendations.jsx`:
```javascript
  const recs = embeddingsPending ? { list: [], personalised: false, totalAvailable: 0 } : getRecommendations();
```
Is it possible that `Recommendations.jsx` uses something that causes it to reset the list?
If `getRecommendations()` returns a NEW object, it triggers a re-render.
Wait, if someone nominates a film, does it get filtered out of the *other* users' lists?
Let's check if the OTHER users refresh their list!
If user A nominates a film, user A calls `replaceRecommendation`. User A's list changes (one item is replaced).
User B receives the `state` update. `state.movies` changes.
User B's `Recommendations.jsx` re-renders because `useStore` triggers it.
Does user B's `getRecommendations` return a new list?
No, because user B's `recSignature` hasn't changed.
So user B's recommendations don't refresh!
BUT wait! Does user B's `recSignature()` include `runtime.state.movies`?
Let me check `recSignature()` again.
```javascript
  return runtime.MOVIE_DB.length + '#' + hist
       + '#' + intr + '#' + ni + '#' + watched
       + '#' + seenSig + '#' + pvSig + '#' + embReady + '#' + filt;
```
It does NOT include `runtime.state.movies`!
Wait. Why does the user say "don't refresh everyone's recommendations any time someone nominates a film etc"?
Could it be that they WANT it to be filtered out, BUT without refreshing?
Ah! If someone nominates a film, it SHOULD be removed from everyone else's recommendations! But right now it ISN'T removed from everyone else's recommendations, because `recSignature` doesn't change, and `replaceRecommendation` is only called by the nominator!
Wait, if it's NOT removed, then everyone else can STILL see it and click Nominate.
If they click Nominate, it's a duplicate, which is ignored:
```javascript
      const isDup = state.movies.some((m) => {
        const mId = resolveId(m.title, m.tmdbId);
        if (targetId && mId) return targetId === mId;
        return m.title.toLowerCase() === title.toLowerCase();
      });
      if (isDup) return;
```
If it's ignored, it just does nothing. BUT it stays on their screen!
Wait, if the user explicitly says "don't refresh everyone's recommendations any time someone nominates a film etc", maybe someone ALREADY added `state.movies.length` to `recSignature` in a PREVIOUS version, and I didn't see it?
Let me check if `recSignature` includes `state.movies.length`!
```javascript
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
```
No, it does NOT include `state.movies`.
So maybe the issue is complaining about `pvSig` or `seenSig` causing a refresh?
"don't refresh everyone's recommendations any time someone nominates a film etc"
Wait. If someone nominates a film, does something ELSE change?
Maybe `myTasteVector()` gets recomputed and broadcasted?!
```javascript
  const onNominate = (m) => {
    actions.nominate(m.title, m.id || m.tmdbId);
    replaceRecommendation(m.title);
    emit();
  };
```
No, `onNominate` DOES NOT call `afterTasteChange()`.
What about `onWatchlist`?
```javascript
  const onWatchlist = (m) => {
    if (inWatchlist(m.title)) removeFromWatchlist(m.title);
    else addToWatchlist(m.title);
    afterTasteChange();
  };
```
Ah! `onWatchlist` DOES call `afterTasteChange()`!
```javascript
export function afterTasteChange() {
  shareVector();
  emit();
}
```
```javascript
export function shareVector() {
  dispatch({ type: 'setVector', vector: myTasteVector() });
}
```
When `afterTasteChange()` is called, it dispatches `setVector`.
Then the host updates `state.peerVectors[fromId]`.
Then the host broadcasts `state`.
Then EVERYONE receives the new `state.peerVectors`.
Then EVERYONE's `pvSig` changes!
Because `pvSig` is in `recSignature`, EVERYONE'S `recSignature` changes!
Then EVERYONE'S `getRecommendations()` calls `ensurePrecompute`!
Then EVERYONE'S recommendations list refreshes (the carousel jumps to the start and gives a whole new list)!
This is EXACTLY what the user is complaining about!
"don't refresh everyone's recommendations any time someone nominates a film etc"
Wait, if someone nominates a film, they don't call `afterTasteChange()`. But if they add to watchlist, they DO. Maybe they also meant rate a film (`onWatched` -> rate -> `afterTasteChange`)!
Wait, but why does the prompt say "nominates a film"?
Let's see if nominating a film triggers a refresh for some other reason.
When someone nominates a film, `state.movies` changes.
Does `state.movies` trigger a refresh in `Recommendations.jsx`?
Look at `Recommendations.jsx`:
```javascript
  const movies = rt.state?.movies || [];
  const myCount = movies.filter((m) => m.by === rt.myId).length;
  const canNominate = rt.state?.phase === 'lobby' && myCount < MAX_NOMINATIONS;
```
If `state.movies` changes, `Recommendations` re-renders.
Is there an effect that resets it?
No...

Wait, the prompt says "don't refresh everyone's recommendations any time someone nominates a film etc".
Maybe they mean ANY change to the room state (nomination, joining, vector change) shouldn't reset the CAROUSEL for everyone?
If someone changes their vector (`setVector`), we WANT to incorporate their taste. BUT we can do it lazily!
Wait! The code ALREADY says:
```javascript
// Re-rank lazily on the next full refresh so the new signal fully propagates,
```
Wait, where is that comment?
Let's grep for "lazily":
