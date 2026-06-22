import { useMemo, useState } from 'react';
import Poster from '../ui/Poster.jsx';
import Stars from '../ui/Stars.jsx';
import { movieMeta } from '../lib/catalog.js';
import { loadHistory, loadWatched, loadWatchlist, removeFromWatchlist, saveWatched } from '../lib/storage.js';
import { markRankingStale } from '../lib/recengine.js';
import { afterTasteChange, shareSeen } from '../state/controller.js';

// Resolve a finishing order from the recorded instant-runoff rounds: the winner
// places first, then everyone else by reverse elimination order (the last
// candidate eliminated finishes second, and so on).
function computeStandings(h) {
  const movies = Array.isArray(h.movies) ? h.movies : [];
  const titleOf = (id) => (movies.find((m) => m.id === id) || {}).title || '—';
  const tmdbOf = (id) => (movies.find((m) => m.id === id) || {}).tmdbId;
  const rounds = Array.isArray(h.rounds) ? h.rounds : [];
  const firstTally = {};
  (rounds[0]?.tally || []).forEach((t) => { firstTally[t.id] = t.votes; });

  const order = [];
  const seen = new Set();
  const add = (id) => { if (id != null && !seen.has(id)) { seen.add(id); order.push(id); } };

  if (h.winnerId != null) add(h.winnerId);
  const eliminated = [];
  rounds.forEach((r) => (r.eliminated || []).forEach((e) => eliminated.push(e.id)));
  eliminated.slice().reverse().forEach(add);
  // Include any movies that were never eliminated or named winner.
  movies.forEach((m) => add(m.id));

  return order.map((id) => ({
    id,
    title: titleOf(id),
    tmdbId: tmdbOf(id),
    votes: firstTally[id] || 0,
    isWinner: id === h.winnerId,
  }));
}

function MovieNightEntry({ h }) {
  const [open, setOpen] = useState(false);
  const standings = useMemo(() => computeStandings(h), [h]);
  const winnerMeta = h.winnerTitle ? movieMeta(h.winnerTitle) : null;

  const movies = Array.isArray(h.movies) ? h.movies : [];
  const titleOf = (id) => (movies.find((m) => m.id === id) || {}).title || '—';
  const peers = Array.isArray(h.peers) ? h.peers : [];
  const nameOf = (id) => {
    const p = peers.find((x) => x.id === id);
    return (p && p.name) || 'Someone';
  };

  const votes = h.votes && typeof h.votes === 'object' ? h.votes : {};
  const voterIds = Object.keys(votes).filter((id) => Array.isArray(votes[id]) && votes[id].length);
  const ballots = voterIds.map((id) => ({
    id,
    name: nameOf(id),
    ranking: votes[id].map((mid) => titleOf(mid)),
  }));
  // Peers present at the night who submitted no ballot.
  const nonVoters = peers
    .filter((p) => !voterIds.includes(p.id))
    .map((p) => p.name || 'Someone');

  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 text-sm">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((v) => !v)}>
        <Poster movie={winnerMeta} title={h.winnerTitle} className="w-10 h-14 rounded overflow-hidden flex-none" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-slate-100">{h.winnerTitle || '—'}</div>
          <div className="text-xs text-slate-400">
            {new Date(h.at || Date.now()).toLocaleString()} · {h.roomId || 'room'}
            {h.totalBallots ? ` · ${h.totalBallots} vote${h.totalBallots === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <i className={`fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'} text-slate-400`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Final ranking</div>
            <div className="space-y-1.5">
              {standings.length === 0 && <div className="text-xs text-slate-500">No ranking recorded.</div>}
              {standings.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <div className="w-5 text-right text-slate-400">{i + 1}.</div>
                  <div className={`flex-1 truncate ${s.isWinner ? 'text-emerald-300 font-semibold' : 'text-slate-200'}`}>
                    {s.title}
                    {s.isWinner && <i className="fa-solid fa-trophy ml-1.5 text-amber-300" />}
                  </div>
                  <div className="text-slate-400">{s.votes} first-choice</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Who voted for what</div>
            <div className="space-y-1.5">
              {ballots.length === 0 && <div className="text-xs text-slate-500">No ballots recorded.</div>}
              {ballots.map((b) => (
                <div key={b.id} className="text-xs">
                  <span className="text-slate-100">{b.name}</span>
                  <span className="text-slate-400"> — {b.ranking.join(' › ')}</span>
                </div>
              ))}
              {nonVoters.length > 0 && (
                <div className="text-xs text-slate-500">Did not vote: {nonVoters.join(', ')}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
            <MovieNightEntry key={`${h.at || idx}-${h.winnerId || idx}`} h={h} />
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
          <h2 className="text-lg font-semibold text-white w-full sm:w-auto sm:mr-auto">Watched</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search watched…" className="flex-1 min-w-0 sm:flex-none bg-panel2 border border-line rounded-lg px-3 py-2 text-sm" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="flex-none bg-panel2 border border-line rounded-lg px-3 py-2 text-sm">
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
