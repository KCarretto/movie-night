import { useEffect, useMemo, useState } from 'react';
import { movieMeta } from '../lib/catalog.js';
import Poster from '../ui/Poster.jsx';
import Stars from '../ui/Stars.jsx';
import { actions } from '../state/controller.js';
import { useStore } from '../state/useStore.js';

export default function Results({ onRateWinner }) {
  const rt = useStore();
  const results = rt.state?.results;
  const movies = rt.state?.movies || [];

  const winner = useMemo(() => {
    if (!results?.winnerId) return null;
    const pick = movies.find((m) => m.id === results.winnerId);
    if (!pick) return null;
    return { pick, meta: movieMeta(pick.title, pick.tmdbId) };
  }, [results, movies]);

  const roundsCount = results?.rounds?.length || 0;
  const [visibleRounds, setVisibleRounds] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    setVisibleRounds(1);
    setIsPlaying(true);
  }, [results?.winnerId, roundsCount]);

  useEffect(() => {
    if (!results) return;
    if (!isPlaying) return;
    if (visibleRounds >= roundsCount) {
      setIsPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      setVisibleRounds((v) => v + 1);
    }, 1400); // 1.4 seconds per round
    return () => clearTimeout(timer);
  }, [visibleRounds, isPlaying, roundsCount, results]);

  const handleReplay = () => {
    setVisibleRounds(1);
    setIsPlaying(true);
  };

  if (!results) {
    return <section className="card p-4 sm:p-5 text-sm text-slate-400">No results yet.</section>;
  }

  return (
    <section className="space-y-4">
      <section className="card p-4 sm:p-5 pop-in">
        <h2 className="text-lg font-semibold text-white mb-3">Winner</h2>
        {winner ? (
          <div className="flex flex-col sm:flex-row gap-4">
            <Poster movie={winner.meta} className="w-32 h-44 rounded-lg overflow-hidden" />
            <div className="space-y-2 min-w-0">
              <div className="text-2xl font-display text-white leading-none">{winner.pick.title}</div>
              <div className="text-sm text-slate-300">{winner.meta?.year || '—'} · {winner.meta?.runtime || '—'} min</div>
              {winner.meta?.ratings?.letterboxd ? <Stars rating={winner.meta.ratings.letterboxd} /> : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" className="btn btn-accent2 px-3 py-2 rounded-lg text-sm text-white" onClick={() => onRateWinner?.(winner.pick.title)}>
                  Mark watched
                </button>
                {rt.isHost && (
                  <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => actions.reset()}>
                    Start new round
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-400">No winner determined.</div>
        )}
      </section>

      <section className="card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-semibold text-white">Round-by-round tally</h3>
          {roundsCount > 1 && (
            <button
              type="button"
              className="btn px-2.5 py-1 rounded-lg border border-line bg-panel2 text-xs flex items-center gap-1.5 hover:bg-slate-800 text-slate-300 disabled:opacity-50"
              onClick={handleReplay}
              disabled={isPlaying}
            >
              <i className={`fa-solid ${isPlaying ? 'fa-spinner fa-spin' : 'fa-arrow-rotate-right'}`} />
              {isPlaying ? 'Animating…' : 'Replay'}
            </button>
          )}
        </div>
        <div className="space-y-3">
          {(results.rounds || []).slice(0, visibleRounds).map((r, idx) => (
            <div key={idx} className="round-card rounded-lg border border-line bg-panel2 p-3">
              <div className="text-sm text-white mb-2">Round {idx + 1}</div>
              <div className="space-y-1.5">
                {(r.tally || []).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs">
                    <div className="w-36 truncate text-slate-200">{t.title}</div>
                    <div className="flex-1 h-2 rounded-full bg-ink overflow-hidden">
                      <div
                        className="h-full bg-accent2 bar-grow"
                        style={{
                          width: `${r.counted ? (t.votes / r.counted) * 100 : 0}%`,
                          transformOrigin: 'left'
                        }}
                      />
                    </div>
                    <div className="w-10 text-right text-slate-300">{t.votes}</div>
                  </div>
                ))}
              </div>
              {r.winner && <div className="text-xs text-emerald-300 mt-2">{r.winReason}</div>}
              {r.eliminationReason && <div className="text-xs text-slate-400 mt-2">{r.eliminationReason}</div>}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
