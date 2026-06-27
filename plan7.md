Wait, if `getRecommendations` is called in `Recommendations.jsx` without options, and `recCache.list` exists, but `recCache.sig !== sig` (e.g. someone else rated a movie), `getRecommendations` will set `recRankingStale = true`, update the signature, and return `recCache` with the SAME list.
This completely prevents the carousel from refreshing/jumping for EVERYONE.
But wait! What if the user themselves applied a filter?
```javascript
  const applyFilterChange = () => {
    markRankingStale();
    getRecommendations({ forceRefresh: true });
    emit();
  };
```
Since it passes `forceRefresh: true`, it will clear the list and refresh the carousel!
What if they rate a movie themselves?
```javascript
  const onNotInterested = (m) => { markNotInterested(m.title); replaceRecommendation(m.title); afterTasteChange(); };
```
`replaceRecommendation` is called!
```javascript
export function replaceRecommendation(title) {
  ...
  const pick = (allowSeen) => ranked.find(...)
  newList[idx] = pick(false) || pick(true);
  ...
  recRankingStale = true;
  recCache = {
    sig: recSignature(),
    list: newList,
    ...
```
`replaceRecommendation` MANUALLY updates `recCache`, updates `sig`, and keeps the rest of the list unchanged!
Then `afterTasteChange()` calls `emit()`.
Then `Recommendations.jsx` re-renders.
It calls `getRecommendations()`.
Since `recCache.sig === sig` (because `replaceRecommendation` just set it), it just returns `recCache`.
Perfect! The carousel doesn't jump.

But wait! What about `onWatchlist`?
```javascript
  const onWatchlist = (m) => {
    if (inWatchlist(m.title)) removeFromWatchlist(m.title);
    else addToWatchlist(m.title);
    afterTasteChange();
  };
```
It does NOT call `replaceRecommendation`!
So it just calls `afterTasteChange()`.
`afterTasteChange()` broadcasts the vector and emits.
`Recommendations.jsx` re-renders, calls `getRecommendations()`.
`recSignature()` has changed (because of watchlist)!
`getRecommendations` sees `recCache.sig !== sig`.
Because of my patch, it will now do:
```javascript
  } else if (recCache.sig !== sig) {
    recRankingStale = true;
    recCache = { ...recCache, sig };
    schedulePrecompute();
  }
```
And return `recCache`.
So the list STAYS exactly the same! The carousel DOES NOT jump!
This is EXACTLY what is desired!

Is there any flaw?
What if `recCache.list` is empty? It does a full refresh. That's fine.
What if `forceRefresh` is called from the UI refresh button?
```javascript
  const forceRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      getRecommendations({ forceRefresh: true });
      emit();
      setIsRefreshing(false);
    }, 300);
  };
```
It passes `forceRefresh: true`, so it does a full refresh.

What about `onOpenTrain` (Improve recommendations)?
When they train, it opens a modal. When the modal closes:
```javascript
// TrainModal.jsx doesn't seem to call forceRefresh on close, let's check
```
