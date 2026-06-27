So `TrainModal.jsx` calls `getRecommendations()`.
If `TrainModal` changes the taste, it calls `afterTasteChange()`.
When it closes, the main page re-renders, calls `getRecommendations()`.
Since `TrainModal` changed taste, `sig` is different.
Because of the patch, it just updates `sig` and marks stale.
Wait! If they clicked "Improve" and rated a bunch of movies, do they WANT the main screen to refresh?
"Improve recommendations" probably SHOULD update the main screen list to show the new personalized picks?
But wait, if it doesn't refresh automatically, they just scroll right to see the new ones (since `appendRecommendations` uses the new ranking), OR they can click the "Refresh" button on the UI!
There is LITERALLY a "Refresh" button on the UI right next to "Improve" and "Insights":
```javascript
        <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={forceRefresh}>
          <i className="fa-solid fa-rotate-right mr-1" />Refresh
        </button>
```
So it's totally fine to make it lazy everywhere, because the user explicitly requested "don't refresh everyone's recommendations any time someone nominates a film etc", and if they DO want a refresh, they can click "Refresh".

I am confident in this fix.
Let's run tests.
