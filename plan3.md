Ah! Wait. If `seenSig` and `pvSig` are in `recSignature()`, then ANY time someone's `peerVectors` or `seen` updates, `recSignature()` changes!
If `recSignature()` changes, the CURRENT list is thrown away, and `getRecommendations` computes a NEW batch and the carousel is completely reset.
If someone nominates a film, does it change `recSignature`?
No, it shouldn't. Wait! Does `runtime.state` change?
Yes, `runtime.state` is replaced in `applyRemoteState`:
```javascript
  runtime.state = remote;
```
If `runtime.state` is replaced, it's a NEW object.
Does `recSignature()` use object identity?
No: `Object.keys(pv).sort().join('|')`
So if `peerVectors` didn't change, `pvSig` is identical!
BUT wait! Does `peerVectors` change?
Ah! `pv` is `runtime.state.peerVectors`.
When `applyAction` runs for `nominate`, it pushes to `state.movies`.
BUT `state.peerVectors` is the SAME object? Yes.
So `pvSig` shouldn't change.
Wait! What if the user is complaining about the fact that ANY update to the room (like someone nominating a film) causes their carousel to jump back to the beginning?
Is it jumping to the beginning because of a re-render?
In `Recommendations.jsx`:
```javascript
      <div className="relative">
        <button ...>
        <button ...>
        <div className="rec-track" ref={trackRef} role="list" aria-label="Recommended movies" onScroll={onTrackScroll}>
```
When `recs.list` changes, the DOM nodes are re-created because their keys might be different, but if `recs.list` is the SAME object, React should just update.
Wait, `recCache` is the SAME object if `recSignature` hasn't changed!
So `recs` is the SAME object.
So the `Recommendations` component should NOT reset its scroll position.
UNLESS...
Wait! The issue says: "don't refresh everyone's recommendations any time someone nominates a film etc".
Is `state.movies.length` part of the signature?!
No, `recSignature` returns:
```javascript
  return runtime.MOVIE_DB.length + '#' + hist
       + '#' + intr + '#' + ni + '#' + watched
       + '#' + seenSig + '#' + pvSig + '#' + embReady + '#' + filt;
```
Wait! What if `state.movies` IS part of it? No.
Let's check `App.jsx` again.
```javascript
const sig = `${rt.roomId}|${rt.state.results?.winnerId}|${rt.state.results?.totalBallots}|${rt.state.movies.length}`;
```
Wait! In `App.jsx`, `sig` is used for HISTORY!
```javascript
  useEffect(() => {
    if (rt.state?.phase !== 'results' || !rt.state?.results?.winnerId) return;
    const sig = `${rt.roomId}|${rt.state.results.winnerId}|${rt.state.results.totalBallots}|${rt.state.movies.length}`;
```
It's just for history.

Wait, why would recommendations refresh?
Maybe I'm missing something in `recSignature`?
Is `seenSig` changing?
Yes, `seen` includes the host!
If the host's `seen` is updated?
Wait, if someone nominates a film, does it change `recSignature`?
Let's do a test!
