1. **Persistent memory for Host/Guest**:
   - Switched `sessionStorage` to `localStorage` for both `movieNightGuestId` and `HOST_ROOM_KEY`.
   - This ensures that if the host/guest opens the room in a new tab, closes the old one, or reloads the browser, their peer ID stays exactly the same.
   - For guests, they will seamlessly reconnect to the room (keeping their identity, nominations, etc.).
   - For the host, they will seamlessly reclaim the room instead of accidentally joining as a guest.

2. **Recommendations Refresh**:
   - Modified `getRecommendations()` and `appendRecommendations()` in `recengine.js` so they no longer obliterate the visible recommendations cache whenever `recSignature` changes.
   - Instead, if `recSignature` differs from `recCache.sig`, they lazily mark `recRankingStale = true` and update the cached signature, but preserve the existing `list`.
   - This ensures the UI carousel does NOT jump back to the beginning every time someone in the room does something that triggers a taste change (e.g., adding to watchlist).
   - If the user genuinely needs a full refresh (like applying a genre filter or manually clicking "Refresh"), they explicitly trigger it using `{ forceRefresh: true }`.

Both parts of the user request are solved.
