1. **Host Reconnection / Persistent Host Memory**
   - The issue asks to "Update the app so that the host remembers the browsers that connect to it, so that reconnecting or opening in a new tab doesn’t create a new user, it just allows the user to seamlessly reconnect to the room."
   - In `src/state/controller.js`, `movieNightGuestId` is used to persist the `peerId` for a guest. We need to make sure this is stored in `localStorage` rather than `sessionStorage` so it persists across tabs/reloads. I have already changed this.
   - For the host side, we must avoid creating duplicate users if a guest reconnects with the same `peerId`.
   - In `hostAddPeer` (`src/state/controller.js`), the host adds peers:
     ```javascript
     if (state.peers.find((p) => p.id === peerId)) return;
     ```
     This checks if the peer is already connected, but wait! What if the guest gets disconnected, `removePeer` is called, and they reconnect?
     `removePeer` only works when in the lobby:
     ```javascript
     if (state.phase !== 'lobby') return; // Don't remove peers once voting starts so they can reconnect
     ```
     If they reconnect, what happens? If they are not in `state.peers`, they get added again. If they ARE in `state.peers`, `hostAddPeer` returns. So during voting, they reconnect, they are in `state.peers`, so they don't get re-added (they just stay).
     But what if they reconnect in the lobby? In the lobby, `removePeer` deletes them from `state.peers` immediately. When they reconnect, they get a NEW name if their name is taken. And their `seen` and `peerVectors` get lost!

     If we want the host to remember browsers that connect to it, maybe the host should *not* forget them in the lobby either? Wait, what if they close the tab and never come back? We probably still want to keep their nominations, etc. If we keep them in `state.peers`, they might be counted when starting voting. We can track whether they are currently "connected" or not via `connections.has(peerId)`. Or we can just remember their peerId across sessions. Actually, `removePeer` entirely removes them.

     Let's look at what the user wants: "reconnecting or opening in a new tab doesn’t create a new user".
     Wait, if they open in a *new tab* (as a guest), they will get the *same* `localStorage` `movieNightGuestId`. So they connect with the *same* `peerId`.
     If they connect with the same `peerId`, but they were already in the room in the first tab. PeerJS doesn't allow two connections with the exact same `peerId` simultaneously without problems. Ah, wait, if you create a new PeerJS instance with a `peerId` that is already taken by another tab, PeerJS gives an `unavailable-id` error!
     Let's check `startGuest`:
     ```javascript
     peer.on('error', (err) => handlePeerError(err));
     ```
     If we reuse `movieNightGuestId` in `localStorage`, and open a new tab, the new tab tries to use the same `peerId` and gets `unavailable-id`? No! PeerJS connects to the signaling server. If the old tab is still connected, the signaling server rejects the new tab with `unavailable-id`.
     So maybe it's better to let them have different `peerId`s but somehow link them? No, the easiest way is to let PeerJS handle it. Or generate a new id if it fails?
     Wait, the issue says: "the host remembers the browsers that connect to it, so that reconnecting or opening in a new tab doesn't create a new user, it just allows the user to seamlessly reconnect to the room."
     Maybe they just mean "if I reload the page or close and reopen, I'm the same user". By changing `sessionStorage` to `localStorage` for `movieNightGuestId`, reloading the page reuses the ID. Because the old page disconnected, the ID is freed on the signaling server, and the new page can claim it. BUT the host might have called `removePeer(peerId)` when the old page disconnected!
     If `removePeer(peerId)` removed them, then when they reconnect, they are added as a *new user* in the host's eyes? No, if their `peerId` is the same, they get added with the same `peerId`. BUT their nominations are linked to `fromId`, which is `peerId`. Wait! If `removePeer` deletes them, does it delete their nominations?
     ```javascript
     function removePeer(peerId) {
       ...
       state.peers = state.peers.filter((p) => p.id !== peerId);
       delete state.votes[peerId];
       if (state.seen) delete state.seen[peerId];
       if (state.peerVectors) delete state.peerVectors[peerId];
     }
     ```
     It does *not* delete their nominations (in `state.movies`), which is good, but it deletes their name, votes, seen, and vectors. Then when they reconnect, `hostAddPeer` is called, and they are added again. But wait, if they are added again with the same `peerId`, they get a *new* name if their old name was taken? Wait, their old name *isn't* taken because they were removed from `state.peers`! So they might get the same name? `loadSavedName()` will send their name in the `join` message.
     However, if they reconnect during the *voting* phase, `removePeer` skips removing them!
     ```javascript
     if (state.phase !== 'lobby') return; // Don't remove peers once voting starts so they can reconnect
     ```
     So during voting, they reconnect seamlessly. But in the lobby, they get deleted and re-added. Is this a problem?
     What if we just *don't* remove them in `removePeer`, but just track `connected` status?
     Or, better yet, instead of removing them immediately in `removePeer`, we keep them in `state.peers`.
     Wait, the issue also mentions "don't refresh everyone's recommendations any time someone nominates a film etc". Let's solve the second part first.

2. **Recommendations Refreshed on Nominations**
   - The issue: "don’t refresh everyone’s recommendations any time someone nominates a film etc"
   - Look at `recSignature()` in `src/lib/recengine.js`:
     ```javascript
     function recSignature() {
       ...
       return runtime.MOVIE_DB.length + '#' + hist
            + '#' + intr + '#' + ni + '#' + watched
            + '#' + seenSig + '#' + pvSig + '#' + embReady + '#' + filt;
     }
     ```
     Wait, does `recSignature` include `runtime.state.movies` (nominations)? NO, it does not.
     So why are recommendations refreshed when someone nominates a film?
     Ah! `computeRecommendations` does:
     ```javascript
     const nominatedSet = new Set(runtime.state.movies.map((m) => normTitle(m.title)));
     ```
     And it skips them!
     ```javascript
     if (nominatedSet.has(nt)) continue;
     ```
     BUT wait, if `recSignature` DOES NOT include nominations, then if a nomination is added, the signature *doesn't* change, so `ensurePrecompute` returns the cached ranking!
     So why would recommendations refresh?
     Let's check `getRecommendations`:
     ```javascript
     export function getRecommendations(options = {}) {
       const forceRefresh = !!options.forceRefresh;
       const sig = recSignature();
       if (forceRefresh || recCache.sig !== sig) {
     ```
     When someone nominates a film, `applyAction` in `controller.js` does:
     ```javascript
     state.movies.push(...);
     broadcastState();
     emit();
     ```
     This triggers a re-render of `App.jsx`, which renders `Recommendations.jsx`.
     `Recommendations.jsx` calls `getRecommendations()`.
     If `recSignature()` hasn't changed, it returns `recCache`.
     BUT wait! `replaceRecommendation(title)` is called on nomination:
     ```javascript
     const onNominate = (m) => {
       actions.nominate(m.title, m.id || m.tmdbId);
       replaceRecommendation(m.title);
       emit();
     };
     ```
     Wait, the issue says: "don't refresh everyone's recommendations any time someone nominates a film etc".
     If `someone else` nominates a film, `applyAction` receives `nominate` action, pushes to `state.movies`, broadcasts state, and `emit()`.
     Does `someone else`'s nomination cause my recommendations to refresh?
     Let's check if `recSignature()` changes when someone nominates a film. NO.
     So `getRecommendations` returns `recCache`. `recCache` is NOT refreshed.
     BUT wait...
     What if `recCache.list` contains the nominated film?
     If someone else nominates a film that is in my `recCache.list`, it stays in my list because `getRecommendations` doesn't rebuild the list.
     BUT wait, what causes the refresh?
     Maybe the issue is about something else that changes the signature?
     Let's look at `controller.js` `applyAction`:
     When someone nominates, no vectors or seen are updated. Only `state.movies`.
     Wait, does `state` change cause `Recommendations` to rerender? Yes, because `Recommendations` calls `useStore()`.
     Does it refresh? No, it just re-renders.
     Wait! Look at `recSignature`:
     ```javascript
     const seenSig = Object.keys(seen).filter((pid) => pid !== runtime.myId).sort().map((pid) =>
       pid + ':' + (Array.isArray(seen[pid]) ? seen[pid].length : 0)).join('|');
     const pv = (runtime.state && runtime.state.peerVectors) || {};
     const pvSig = Object.keys(pv).sort().join('|');
     ```
     If the user who nominated is a *new* user, maybe they joined and updated `pvSig`?
     Wait, if someone joins, `hostAddPeer` adds them to `peers`. `pvSig` only changes when they set their vector.
     But wait! Is there a bug where `pvSig` changes often?
     No, but wait! What if `runtime.state.movies.length` is used in `recSignature`? It's not.
     Let's read `recSignature` carefully.
     Wait, does `state.movies` change `recSignature`? No.
     So why does the user say: "don’t refresh everyone’s recommendations any time someone nominates a film etc"
     Let's look at where `forceRefresh` is called in `Recommendations.jsx`.
     Nowhere on network update.
     But wait... if someone *joins* or their `peerVectors` change, it refreshes!
     Ah! In `Recommendations.jsx`, `recSignature()` uses `pvSig`. When someone joins and sets their vector, `pvSig` changes.
     If a peer sends their vector, `pvSig` changes, which triggers a full refresh (and shuffling of the list!).
     Also, if `seenSig` changes (someone adds a movie to watched), it triggers a full refresh!
     And what if they vote? `state.votes` changes, but `recSignature` doesn't depend on it.
     But maybe the user meant: "when someone joins, or when someone changes their taste, don't just clear my screen and refresh my recommendations immediately, it's disruptive."
     Wait! "don’t refresh everyone’s recommendations any time someone nominates a film etc"
     Wait! Does nominating a film change something else?
     Let's check `controller.js` `applyAction` for `nominate`:
     It just pushes to `state.movies`.
     Does `replaceRecommendation` refresh the whole list? No, it just replaces the one item.
     But what if `someone else` nominates a film? They dispatch `nominate`.
     Ah! Look at `App.jsx`:
     ```javascript
     const sig = `${rt.roomId}|${rt.state.results?.winnerId}|${rt.state.results?.totalBallots}|${rt.state.movies.length}`;
     ```
     Wait, `App.jsx` might be unmounting/remounting `Recommendations`?!
     ```javascript
     <Lobby ... key={sig} ... />
     ```
     Wait, `Lobby` is NOT keyed by `sig`. `App.jsx` has:
     ```javascript
     const sig = `${rt.roomId}|${rt.state.results?.winnerId}|${rt.state.results?.totalBallots}|${rt.state.movies.length}`;
     ```
     Where is `sig` used?
     Let's check `App.jsx`!
