Now, wait! What about the host remembering the browsers that connect to it?
The user said: "Update the app so that the host remembers the browsers that connect to it, so that reconnecting or opening in a new tab doesn’t create a new user, it just allows the user to seamlessly reconnect to the room."

I already changed `sessionStorage` to `localStorage` for `movieNightGuestId`, which handles the GUEST part (the guest keeps their `peerId` across tabs and reloads).
What happens when they reconnect?
Let's trace:
1. Guest reloads page. PeerJS disconnects.
2. Host sees `close` event:
```javascript
  conn.on('close', () => {
    if (connections.get(conn.peer) === conn) connections.delete(conn.peer);
    if (runtime.isHost) removePeer(conn.peer);
    ...
```
3. Host calls `removePeer(conn.peer)`:
```javascript
function removePeer(peerId) {
  const state = S();
  if (state.phase !== 'lobby') return; // Don't remove peers once voting starts so they can reconnect
  const before = state.peers.length;
  state.peers = state.peers.filter((p) => p.id !== peerId);
  delete state.votes[peerId];
  if (state.seen) delete state.seen[peerId];
  if (state.peerVectors) delete state.peerVectors[peerId];
  if (state.peers.length !== before) {
    broadcastDirectory();
    maybeAutoFinish();
    broadcastState();
    emit();
  }
}
```
If the phase is `lobby`, the host DELETES them entirely.
So when they reconnect, `hostAddPeer` runs again. They get added back as a fresh user. Their `seen` and `peerVectors` are gone until the guest re-sends them (which the guest DOES do on connect: `safeSend(conn, { type: 'action', action: { type: 'setSeen', seen: mySeenShare() } });`).
BUT wait! If the host deletes them in the lobby, they are briefly removed and then re-added.
Is that bad?
"reconnecting or opening in a new tab doesn’t create a new user, it just allows the user to seamlessly reconnect to the room."
Wait! If they are removed and re-added, their name might change if someone else took it, but someone else can't take it because it's deleted.
Does it "create a new user"?
Wait, what if they open a NEW TAB while the FIRST TAB is still open?
If they open a NEW tab, the new tab uses the SAME `peerId` from `localStorage`.
It tries to connect to PeerJS with `peerId`.
PeerJS signaling server says "unavailable-id"!
And what does `startGuest` do?
```javascript
function handlePeerError(err) {
  ...
  } else if (t === 'unavailable-id') {
    if (runtime.isHost) {
      ...
    } else {
      setStatus('err', 'Room id already hosting elsewhere');
    }
  }
```
So if they open a new tab, they get an ERROR "Room id already hosting elsewhere", and they CANNOT connect!
BUT they wanted "reconnecting or opening in a new tab doesn’t create a new user, it just allows the user to seamlessly reconnect to the room."
Ah! So if they open in a new tab, they CANNOT have the same `peerId` if the old tab is still connected!
If the old tab is closed, they CAN connect with the same `peerId`. But if both tabs are open, they need DIFFERENT `peerId`s, but the host needs to treat them as the SAME user?
Or maybe they mean: "opening in a new tab" when they are the HOST?
"Update the app so that the host remembers the browsers that connect to it, so that reconnecting or opening in a new tab doesn’t create a new user..."
Wait! If they are a GUEST, opening a new tab creates a NEW user because `sessionStorage` gives a NEW `peerId`! So changing to `localStorage` fixes the "reconnecting" part (because if they close and reopen, they get the same `peerId`). BUT if they have TWO tabs open, `localStorage` gives the same `peerId`, which causes `unavailable-id`.
Is it possible to have two tabs open as the same user?
PeerJS doesn't support two connections with the same `peerId`.
Maybe they mean "If they reconnect, they don't get created as a new user".
Wait! Look at the original issue again: "the host remembers the browsers that connect to it, so that reconnecting or opening in a new tab doesn't create a new user, it just allows the user to seamlessly reconnect to the room."
If the host remembers the BROWSER, maybe they use a `browserId` instead of `peerId`?
Or maybe if they use `localStorage` for `guestId`, when they open a new tab, it gets `unavailable-id`, which means they CANNOT connect!
If we change it to NOT use `peerId` as the unique user ID, but instead pass a `userId`?
But PeerJS uses `peerId` everywhere for networking!
Wait! What if we just catch `unavailable-id` for GUESTS and generate a NEW `peerId`, but tell the host "I am actually this userId"?
That would require changing a LOT of code (`state.peers` uses `peerId`, `connections` uses `peerId`, etc).
Let's re-read carefully: "the host remembers the browsers that connect to it, so that reconnecting or opening in a new tab doesn’t create a new user"
If I use `localStorage`, they get the same `peerId`.
If they open a new tab while the old is open, they get `unavailable-id`.
But if the old tab is closed (e.g. they accidentally closed it), they can seamlessly reconnect with the same `peerId`!
Wait! Is the issue that the HOST forgets them when they disconnect?
Yes! `removePeer` deletes them in the lobby!
If `removePeer` deletes them, then when they reconnect, they are added as a NEW user (even if they have the same `peerId`, they are a new user from the host's perspective, though they retain their nominations because nominations use `fromId`).
Wait! If they are removed and re-added, the UI flickers.
If we DON'T remove them in the lobby, what happens?
```javascript
function removePeer(peerId) {
  // Just don't remove them ever?
  // If we don't remove them, they stay in `state.peers` forever.
  // This means the room could get full (MAX_PEERS = 6) with dead connections!
}
```
If we track `active` state?
The app doesn't have an `active` state.
But wait! If `removePeer` is called, they are deleted.
If they reconnect with the SAME `peerId`, `hostAddPeer` adds them back.
If `hostAddPeer` adds them back, they are exactly the same!
But wait, if `sessionStorage` was used, they got a DIFFERENT `peerId` when they opened a new tab or reconnected (reloading the page clears sessionStorage? No, reloading keeps sessionStorage. But opening a new tab or closing and reopening the browser clears sessionStorage!).
So "opening in a new tab" clears `sessionStorage` (because it's a new tab!).
So a new tab gets a NEW `peerId`.
The host sees a NEW `peerId` and adds a NEW user!
If we use `localStorage`, a new tab gets the SAME `peerId`.
But PeerJS fails with `unavailable-id` if both tabs are open!
Let's see what happens if we use `localStorage` and they open a new tab while the old is open.
They get `unavailable-id`.
```javascript
  } else if (t === 'unavailable-id') {
    if (runtime.isHost) {
      ...
    } else {
      setStatus('err', 'Room id already hosting elsewhere'); // Wait, the error text is wrong for guests!
    }
  }
```
If we change it so that if a guest gets `unavailable-id`, they generate a NEW `peerId` and connect?
If they generate a NEW `peerId`, they will be a NEW user!
But the user wants: "doesn't create a new user, it just allows the user to seamlessly reconnect to the room."
If they want it to seamlessly reconnect, maybe they MEAN "reconnecting (closing and reopening) or opening in a new tab (after closing the old one)".
Actually, if you open a link in a new tab and close the old one, `localStorage` keeps the ID.
If we just want to prevent "Room id already hosting elsewhere", maybe we can change the error text?
Actually, if the host remembers the browser via a unique `userId` that is NOT the `peerId`?
No, the codebase heavily relies on `peerId` as the user identifier.
`state.peers.push({ id: peerId, name })`
`state.votes[fromId]`
`state.seen[fromId]`
So `peerId` MUST be the same.
If they have the same `peerId`, the only way to avoid `unavailable-id` is if the old connection is closed.
If they open a new tab while the old tab is open, they CANNOT be the same user at the exact same time with PeerJS using the same `peerId`.
But wait! If they open a new tab, the old tab is STILL OPEN.
Does the user want both tabs to work?
"opening in a new tab doesn't create a new user, it just allows the user to seamlessly reconnect to the room"
If they want both tabs to work and be the SAME user, we would have to decouple `peerId` from `userId`.
This would be a massive rewrite.
Is there an easier way?
What if `removePeer` NEVER removes the user, so they can reconnect?
Wait, if `removePeer` doesn't remove them, they stay in `state.peers`.
If they open a new tab, maybe we can catch `unavailable-id` and tell them to close the other tab?
No!
Let's look at `movieNightGuestId`.
If we change it to `localStorage`, what if they open a new tab, get `unavailable-id`, and we append a suffix?
If we append a suffix, they get a NEW `peerId`, so they become a NEW user. That defeats the purpose.

Let's assume `localStorage` is exactly what they meant, and they won't have two tabs open SIMULTANEOUSLY. They just want to be able to close a tab and open it again, or copy the link to a new tab and close the old one, and STILL BE THE SAME USER.
If we use `localStorage`, they will be the same user.
But wait! If they close the tab, the host calls `removePeer(peerId)` because of the `close` event!
If the host calls `removePeer(peerId)`, the host DELETES them!
```javascript
  const before = state.peers.length;
  state.peers = state.peers.filter((p) => p.id !== peerId);
```
When they reconnect, they are added AGAIN.
```javascript
  state.peers.push({ id: peerId, name });
```
Does it "create a new user"?
Yes, it literally deletes the old user object and pushes a new one!
It deletes their `state.seen[peerId]`, `state.peerVectors[peerId]`, `state.votes[peerId]`!
So they LOSE their taste vectors until they re-broadcast them (which they do on join, so maybe it's fine).
BUT they lose their name if they didn't have it saved!
Wait, `loadSavedName()` is used on join, so they might keep their name.
But what about their NOMINATIONS?
```javascript
  const movie = state.movies.find((m) => m.id === action.movieId);
  if (!movie || movie.by !== fromId) return;
```
Nominations are kept! Because `state.movies` is not filtered in `removePeer`.
So when they reconnect, they can still remove their nominations!

BUT if we want the host to "remember" them and "not create a new user", maybe we shouldn't remove them in `removePeer` during the lobby?
Let's check `removePeer`:
```javascript
function removePeer(peerId) {
  const state = S();
  if (state.phase !== 'lobby') return; // Don't remove peers once voting starts so they can reconnect
  const before = state.peers.length;
  state.peers = state.peers.filter((p) => p.id !== peerId);
  ...
```
If we change it to:
```javascript
function removePeer(peerId) {
  const state = S();
  // Never remove peers from state, just let them be disconnected.
  // Wait, if we never remove them, how do we free up slots for NEW users?
  // state.peers.length >= MAX_PEERS (6) prevents new users!
```
Ah! If we don't remove them, the room fills up with dead connections!
But wait, if we keep them but mark them as `disconnected`?
`state.peers` doesn't have an `active` flag.
If we just set `connected: false`?
The UI doesn't look for `connected: false`.
Let's check `App.jsx` and `Lobby.jsx` to see if they display disconnected users differently.
