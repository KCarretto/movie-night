import { useMemo, useState } from 'react';
import Poster from '../ui/Poster.jsx';
import Stars from '../ui/Stars.jsx';
import { movieMeta } from '../lib/catalog.js';
import { loadHistory, loadWatched, loadWatchlist, removeFromWatchlist, saveWatched } from '../lib/storage.js';
import { markRankingStale } from '../lib/recengine.js';
import { afterTasteChange, shareSeen } from '../state/controller.js';

export default function History() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const [tick, setTick] = useState(0);

  const history = useMemo(() => loadHistory().slice().reverse(), [tick]);
  const watchlist = useMemo(() => loadWatchlist().slice().reverse(), [tick]);
  const watched = useMemo(() => {
    const rows = loadWatched().slice();
    rows.sort((a, b) => {
      if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (sort === 'title') return String(a.title).localeCompare(String(b.title));
      return (b.watchedAt || 0) - (a.watchedAt || 0);
    });
    return rows;
  }, [sort, tick]);

  const query = q.trim().toLowerCase();
  const watchedFiltered = watched.filter((w) => !query || w.title.toLowerCase().includes(query));

  const removeWatched = (title) => {
    const next = loadWatched().filter((w) => w.title.toLowerCase() !== title.toLowerCase());
    saveWatched(next);
    markRankingStale();
    shareSeen();
    afterTasteChange();
    setTick((v) => v + 1);
  };

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5">
        <h2 className="text-lg font-semibold text-white mb-2">Movie nights</h2>
        <div className="space-y-2">
          {history.length === 0 && <div className="text-sm text-slate-400">No completed rounds yet.</div>}
          {history.map((h, idx) => (
            <div key={idx} className="rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
              <div className="text-slate-100">{h.winnerTitle || '—'}</div>
              <div className="text-xs text-slate-400">{new Date(h.at || Date.now()).toLocaleString()} · {h.roomId || 'room'}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="text-lg font-semibold text-white mb-2">Watchlist</h2>
        <div className="space-y-2">
          {watchlist.length === 0 && <div className="text-sm text-slate-400">No watchlist entries yet.</div>}
          {watchlist.map((w) => {
            const meta = movieMeta(w.title);
            return (
              <div key={`${w.title}-${w.addedAt}`} className="rounded-lg border border-line bg-panel2 p-2.5 flex items-center gap-2">
                <Poster movie={meta} title={w.title} className="w-12 h-16 rounded overflow-hidden" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">{w.title}</div>
                  <div className="text-xs text-slate-400">Added {new Date(w.addedAt || Date.now()).toLocaleDateString()}</div>
                </div>
                <button
                  type="button"
                  className="text-slate-400 hover:text-rose-300"
                  onClick={() => { removeFromWatchlist(w.title); afterTasteChange(); setTick((v) => v + 1); }}
                >
                  <i className="fa-solid fa-trash" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold text-white mr-auto">Watched</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search watched…" className="bg-panel2 border border-line rounded-lg px-3 py-2 text-sm" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-panel2 border border-line rounded-lg px-3 py-2 text-sm">
            <option value="recent">Most recent</option>
            <option value="rating">Highest rated</option>
            <option value="title">Title</option>
          </select>
        </div>
        <div className="space-y-2">
          {watchedFiltered.length === 0 && <div className="text-sm text-slate-400">No watched titles.</div>}
          {watchedFiltered.map((w) => {
            const meta = movieMeta(w.title);
            return (
              <div key={`${w.title}-${w.watchedAt}`} className="rounded-lg border border-line bg-panel2 p-2.5 flex items-center gap-2">
                <Poster movie={meta} title={w.title} className="w-12 h-16 rounded overflow-hidden" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">{w.title}</div>
                  <div className="text-xs text-slate-400">{new Date(w.watchedAt || Date.now()).toLocaleDateString()}</div>
                </div>
                <Stars rating={w.rating || 0} className="text-sm" />
                <button type="button" className="text-slate-400 hover:text-rose-300" onClick={() => removeWatched(w.title)}>
                  <i className="fa-solid fa-trash" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
