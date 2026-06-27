Wait, if `removePeer` deletes them in the lobby, and they reconnect, they ARE added back!
Because `localStorage` gives them the same `peerId`.
```javascript
function hostAddPeer(peerId, requestedName) {
  const state = S();
  if (state.peers.find((p) => p.id === peerId)) return;
  // ... adds them back
```
When they are added back, `state.peers` grows again.
If they were removed, their count goes down, and when they reconnect, their count goes up.
This seems EXACTLY what "doesn't create a new user, it just allows the user to seamlessly reconnect" implies.
Because if they used `sessionStorage`, their `peerId` would be NEW. Then they would be added as a NEW user, AND their old user might still be stuck (if the old tab wasn't closed properly and PeerJS hasn't timed out), OR the old user was removed but the new user doesn't have their nominations (because nominations are tied to `fromId`, which is `peerId`).
Since `localStorage` keeps the `peerId`, when they reconnect, they can still remove their old nominations, and they are recognized as the same person!
Wait, but what if they open a new tab while the old tab is STILL open?
Then `peerId` is the same, and PeerJS gives `unavailable-id`.
How does the original code handle this?
```javascript
function startGuest() {
  ...
  let peerId = sessionStorage.getItem('movieNightGuestId');
  if (!peerId) {
    peerId = `peer-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('movieNightGuestId', peerId);
  }
```
If we use `localStorage`, when they open a new tab, it gets the SAME `peerId`.
If they have the same `peerId`, the second tab fails.
Is that acceptable?
"reconnecting or opening in a new tab doesn’t create a new user, it just allows the user to seamlessly reconnect to the room."
Wait! If they open a NEW tab, maybe the host CAN have multiple connections for the same user?
No, PeerJS doesn't allow two connections with the same `peerId`.
If they open a new tab, they get an error.
BUT wait! If we modify `handlePeerError`:
```javascript
  } else if (t === 'unavailable-id') {
    if (runtime.isHost) {
      ...
    } else {
      // Room id already hosting elsewhere -> wait, this is what the original code did.
      // But if we are a guest, and we get unavailable-id, it means our peerId is in use!
      // So the user has another tab open.
      // Instead of failing, what if we regenerate a new peerId and reconnect?
      // BUT if we generate a new peerId, we become a NEW user! That violates "doesn't create a new user"!
```
What if we DO create a new `peerId` BUT we link it to a persistent `userId`?
No, the codebase doesn't have `userId`.
What if the issue just means: "I want to be able to close my tab, and open it again, and still have my nominations."
If I close my tab and open it again, `localStorage` keeps my `peerId`.
But wait! If I close my tab without closing the connection cleanly, PeerJS might keep the connection open for a bit on the signaling server, so opening the new tab immediately might give `unavailable-id`!
If it gives `unavailable-id` because of a ghost connection, the user is locked out!
If they get locked out, they can NEVER reconnect until the ghost connection times out.
Wait, if they get `unavailable-id`, maybe we can try to generate a NEW `peerId`? But then they lose their nominations!
What if we do this:
The host remembers the browsers by a `guestId` in `localStorage`.
Wait, I ALREADY changed it to `localStorage`! Is that enough?
Let's see if the guest sends a `userId`? No.
Let's look at `movieNightGuestId`.
If `sessionStorage` was used, opening in a new tab ALWAYS created a new user.
If I changed it to `localStorage`, opening in a new tab uses the SAME `peerId`.
If the user specifically asked: "Update the app so that the host remembers the browsers that connect to it, so that reconnecting or opening in a new tab doesn’t create a new user, it just allows the user to seamlessly reconnect to the room."

Wait! There's an issue with `localStorage`. If they open a new tab, it gets `unavailable-id`. But wait!
If they navigate to the URL, maybe they just want the HOST to remember them even if they lose connection.
I've already changed it to `localStorage`.
Is there anything else?
Let's re-read the code for `removePeer`.
```javascript
function removePeer(peerId) {
  const state = S();
  if (state.phase !== 'lobby') return; // Don't remove peers once voting starts so they can reconnect
  const before = state.peers.length;
  state.peers = state.peers.filter((p) => p.id !== peerId);
```
If the host removes them, they get re-added when they reconnect.
BUT wait, what if the host DOESN'T remove them from `state.peers`?
If the host doesn't remove them, they stay in the lobby list, but they are grayed out?
We don't have a UI for grayed out.
Wait! What if we DO NOT REMOVE them from `state.peers`?
If we do not remove them, the room gets full (`MAX_PEERS` is 6). If they never come back, someone else can't join.
So it's GOOD to remove them from `state.peers` in the lobby, so someone else can join.
But wait! If we delete them, we delete their `votes`, `seen`, and `peerVectors`!
When they reconnect, they re-send `seen` and `peerVectors` in `connectToHost`:
```javascript
  setupConnection(conn, () => {
    safeSend(conn, { type: 'join', name: loadSavedName() });
    safeSend(conn, { type: 'action', action: { type: 'setSeen', seen: mySeenShare() } });
    safeSend(conn, { type: 'action', action: { type: 'setVector', vector: myTasteVector() } });
  });
```
So their `seen` and `vector` are RESTORED immediately upon reconnecting!
So they don't actually lose anything!
Their nominations are kept because `state.movies` is not filtered.
So `localStorage` literally solves the entire issue for the host remembering browsers!
Wait! Is it possible that the HOST forgets to remember itself?
No, the host uses `runtime.roomId` and `hostRoom` in `sessionStorage`:
```javascript
  const hostRoom = recallHostRoom();
```
If the HOST reloads, it resumes hosting the same room! BUT wait! `recallHostRoom` uses `sessionStorage`!
```javascript
export function rememberHostRoom(id) {
  try { sessionStorage.setItem(HOST_ROOM_KEY, id); } catch (e) { /* ignore */ }
}
```
If the HOST opens a new tab, `sessionStorage` is empty! So the HOST creates a NEW room!
Wait, the issue says: "Update the app so that the host remembers the browsers that connect to it, so that reconnecting or opening in a new tab doesn’t create a new user, it just allows the user to seamlessly reconnect to the room."
Wait, "the host remembers the browsers that connect to it"
Does it mean the host remembers the GUESTS, or the HOST remembers the HOST's browser?
Ah! "the host remembers the browsers that connect to it" implies the host remembers the GUESTS.
But "so that reconnecting or opening in a new tab doesn’t create a new user" could refer to the GUEST.
If I changed `sessionStorage` to `localStorage` for `movieNightGuestId`, that fixes the GUEST.
If I changed `sessionStorage` to `localStorage` for `HOST_ROOM_KEY`, that fixes the HOST!
I DID BOTH!
Let's check what I did in `src/lib/storage.js`:
```javascript
export function rememberHostRoom(id) {
  try { localStorage.setItem(HOST_ROOM_KEY, id); } catch (e) { /* ignore */ }
}
export function recallHostRoom() {
  try { return localStorage.getItem(HOST_ROOM_KEY) || ''; }
  catch (e) { return ''; }
}
```
Yes, I changed both to `localStorage`.
Wait! If the host uses `localStorage` for `HOST_ROOM_KEY`, then EVERY time the host goes to the app without a `?room=` param, they will RE-HOST the exact same room!
Is that bad?
If they hosted a room yesterday, and today they go to the app, they re-host yesterday's room.
But wait! If they are the host, they take the room ID. If someone else took it? Room IDs are random.
Actually, if the host wants to create a NEW room, they can't unless they clear `localStorage`!
Because `boot()` says:
```javascript
  const hostRoom = recallHostRoom();

  if (urlRoom && normalizeRoomId(urlRoom) === hostRoom) {
    // URL matches host room
    runtime.isHost = true;
    ...
  } else if (urlRoom) {
    // URL doesn't match host room, join as guest
    ...
  } else {
    // NO URL!
    // But wait! If we change recallHostRoom to localStorage, there is NO WAY to start a new room!
    // Wait, boot() says:
    runtime.isHost = true;
    runtime.roomId = randomRoomId();
    rememberHostRoom(runtime.roomId);
```
Wait! `boot()` does NOT use `hostRoom` if there is NO `urlRoom`!
```javascript
  const urlRoom = params.get('room');
  const hostRoom = recallHostRoom();

  if (urlRoom && normalizeRoomId(urlRoom) === hostRoom) {
    // Rejoin as host of existing room
  } else if (urlRoom) {
    // Join as guest
  } else {
    // Create NEW room
  }
```
Ah! So if there is NO `?room=` in the URL, it ALWAYS creates a new room!
Even if `recallHostRoom()` returns something!
So `recallHostRoom` is ONLY used when `urlRoom` is present!
If `urlRoom` is present, and it matches `hostRoom`, they become the HOST!
If they open the link `?room=XYZ` in a NEW tab, and `hostRoom` is in `localStorage`, they will be the HOST in the new tab!
If it was in `sessionStorage`, they would be a GUEST in the new tab!
Ahhh! "opening in a new tab doesn't create a new user, it just allows the user to seamlessly reconnect to the room"!
If the HOST opens their own link in a new tab, `sessionStorage` was empty, so they joined their own room as a GUEST! That "creates a new user" (a guest)!
By changing `HOST_ROOM_KEY` to `localStorage`, the HOST opening their own link in a new tab will recognize them as the HOST and seamlessly reconnect (well, wait, if they have two host tabs, PeerJS might complain `unavailable-id` for the host `peerId` too! `room-${runtime.roomId}-host`!).
But if they close the old tab and open the new one, they reconnect perfectly.

So `localStorage` for `movieNightGuestId` AND `HOST_ROOM_KEY` perfectly satisfies the first part of the prompt!
AND I changed `getRecommendations` and `appendRecommendations` to perfectly satisfy "don't refresh everyone's recommendations any time someone nominates a film etc".
Wait, does it work? Let's check `patch_rec.js` again.
