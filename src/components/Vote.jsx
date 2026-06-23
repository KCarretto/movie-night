import { useEffect, useMemo, useState } from 'react';
import { movieMeta } from '../lib/catalog.js';
import GenreTags from '../ui/GenreTags.jsx';
import LanguageBadge from '../ui/LanguageBadge.jsx';
import { actions } from '../state/controller.js';
import { useStore } from '../state/useStore.js';

function reorder(arr, from, to) {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function Vote() {
  const rt = useStore();
  const movies = rt.state?.movies || [];
  const myVote = rt.state?.votes?.[rt.myId] || [];
  const [ranking, setRanking] = useState([]);
  const [dragId, setDragId] = useState(null);

  useEffect(() => {
    const ids = movies.map((m) => m.id);
    const seeded = [...myVote.filter((id) => ids.includes(id)), ...ids.filter((id) => !myVote.includes(id))];
    setRanking(seeded);
  }, [movies, myVote]);

  const byId = useMemo(() => new Map(movies.map((m) => [m.id, m])), [movies]);
  const votesIn = Object.keys(rt.state?.votes || {}).length;

  const submit = (e) => {
    e.preventDefault();
    actions.vote(ranking);
  };

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-white mr-auto">Rank your ballot</h2>
        <div className="text-xs text-slate-400">Votes in: {votesIn}/{rt.state?.peers?.length || 0}</div>
        {rt.isHost && (
          <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={() => actions.closeVoting()}>
            Close voting now
          </button>
        )}
      </div>

      <form onSubmit={submit} className="space-y-2.5">
        {ranking.map((id, idx) => {
          const m = byId.get(id);
          if (!m) return null;
          const meta = movieMeta(m.title, m.tmdbId);
          return (
            <div
              key={id}
              className="rank-row draggable rounded-lg border border-line bg-panel2 p-2.5"
              draggable
              onDragStart={() => setDragId(id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (!dragId || dragId === id) return;
                const from = ranking.indexOf(dragId);
                const to = ranking.indexOf(id);
                if (from === -1 || to === -1) return;
                setRanking(reorder(ranking, from, to));
                setDragId(null);
              }}
            >
              <div className="flex items-start gap-2">
                <div className="drag-handle text-slate-500 mt-0.5"><i className="fa-solid fa-grip-vertical" /></div>
                <div className="text-xs text-slate-400 mt-1">#{idx + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-100">{m.title}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                    {meta && <GenreTags movie={meta} />}
                    {meta && <LanguageBadge movie={meta} />}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button type="button" className="text-slate-400 hover:text-white" onClick={() => idx > 0 && setRanking(reorder(ranking, idx, idx - 1))} aria-label="Move up">
                    <i className="fa-solid fa-chevron-up" />
                  </button>
                  <button type="button" className="text-slate-400 hover:text-white" onClick={() => idx < ranking.length - 1 && setRanking(reorder(ranking, idx, idx + 1))} aria-label="Move down">
                    <i className="fa-solid fa-chevron-down" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        <button type="submit" className="btn btn-primary px-3 py-2 rounded-lg text-white text-sm">
          Submit ranking
        </button>
      </form>
    </section>
  );
}
