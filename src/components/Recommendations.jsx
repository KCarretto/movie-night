import { useMemo, useRef } from 'react';
import { emit } from '../lib/runtime.js';
import { LANGUAGE_INFO } from '../lib/format.js';
import { getRecommendations, recommendationDataStatus } from '../lib/recengine.js';
import { useStore } from '../state/useStore.js';
import RecCard from './RecCard.jsx';

function toggleItem(arr, item) {
  const idx = arr.indexOf(item);
  if (idx === -1) return [...arr, item];
  return arr.filter((x) => x !== item);
}

export default function Recommendations({ onOpenRec, onOpenInsights, onOpenTrain }) {
  const rt = useStore();
  const trackRef = useRef(null);
  const dataStatus = recommendationDataStatus();
  const recs = getRecommendations();

  const genres = useMemo(() => {
    const s = new Set();
    for (const m of rt.MOVIE_DB) (m.genres || []).forEach((g) => s.add(g));
    return [...s].sort((a, b) => a.localeCompare(b)).slice(0, 32);
  }, [rt.MOVIE_DB]);

  const languages = useMemo(() => {
    const s = new Set();
    for (const m of rt.MOVIE_DB) if (m.language) s.add(m.language);
    return [...s].sort().slice(0, 16);
  }, [rt.MOVIE_DB]);

  const forceRefresh = () => {
    getRecommendations({ forceRefresh: true });
    emit();
  };

  const setGenres = (next) => { rt.activeSelectedGenres = next; emit(); };
  const setLanguages = (next) => { rt.activeSelectedLanguages = next; emit(); };

  const shimmer = rt.embeddingsStatus === 'loading' && recs.list.length === 0;

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2.5 mb-3">
        <h2 className="text-lg font-semibold text-white mr-auto">Recommendations</h2>
        <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={onOpenTrain}>Improve</button>
        <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={onOpenInsights}>Insights</button>
        <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={forceRefresh}>Refresh</button>
        {dataStatus && (
          <span className="text-xs text-slate-300 inline-flex items-center gap-1.5" title={dataStatus.message}>
            <span className={`dot ${dataStatus.level === 'loading' ? 'pulse' : ''} ${dataStatus.level === 'error' ? 'bg-rose-400' : 'bg-amber-400'}`} />
            {dataStatus.level}
          </span>
        )}
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex flex-wrap gap-1.5">
          {genres.map((g) => {
            const on = rt.activeSelectedGenres.includes(g);
            return (
              <button
                key={g}
                type="button"
                className={`genre-tag ${on ? '!border-accent2 !text-white' : ''}`}
                onClick={() => setGenres(toggleItem(rt.activeSelectedGenres, g))}
              >
                {g}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {languages.map((code) => {
            const info = LANGUAGE_INFO[code];
            const label = info ? `${info.flag} ${info.name}` : code.toUpperCase();
            const on = rt.activeSelectedLanguages.includes(code);
            return (
              <button
                key={code}
                type="button"
                className={`lang-badge ${on ? '!border-accent2 !text-white' : ''}`}
                onClick={() => setLanguages(toggleItem(rt.activeSelectedLanguages, code))}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <button type="button" className="rec-nav rec-prev" onClick={() => trackRef.current?.scrollBy({ left: -280, behavior: 'smooth' })} aria-label="Previous recommendations">
          <i className="fa-solid fa-chevron-left" />
        </button>
        <button type="button" className="rec-nav rec-next" onClick={() => trackRef.current?.scrollBy({ left: 280, behavior: 'smooth' })} aria-label="Next recommendations">
          <i className="fa-solid fa-chevron-right" />
        </button>

        <div className="rec-track" ref={trackRef}>
          {shimmer && Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rec-card rec-shimmer">
              <div className="shimmer-block shimmer-poster" />
              <div className="p-2.5 space-y-2">
                <div className="shimmer-block h-3" />
                <div className="shimmer-block h-3 w-2/3" />
              </div>
            </div>
          ))}

          {!shimmer && recs.list.map((rec) => (
            <RecCard key={`${rec.movie.id || rec.movie.title}-${rec.score}`} rec={rec} onOpen={onOpenRec} />
          ))}

          {!shimmer && recs.list.length === 0 && (
            <div className="text-sm text-slate-400 px-1 py-4">No matches yet. Try clearing filters or adding more watched/rated titles.</div>
          )}
        </div>
      </div>

      <div className="mt-2 text-xs text-slate-400">
        {recs.personalised ? 'Personalised picks' : 'Popularity-first picks'} · {recs.totalAvailable} candidates
      </div>
    </section>
  );
}
