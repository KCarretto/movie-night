import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_NOMINATIONS } from '../lib/constants.js';
import { emit } from '../lib/runtime.js';
import { LANGUAGE_INFO } from '../lib/format.js';
import {
  getRecommendations, recommendationDataStatus, markRankingStale, replaceRecommendation,
  appendRecommendations,
} from '../lib/recengine.js';
import {
  inWatchlist, addToWatchlist, removeFromWatchlist, markNotInterested,
  addRecentlyNominated, findWatched,
} from '../lib/storage.js';
import { actions, afterTasteChange } from '../state/controller.js';
import { useStore } from '../state/useStore.js';
import MultiSelect from '../ui/MultiSelect.jsx';
import RecCard from './RecCard.jsx';

// How long to hold the first-load shimmer before falling back to popularity-only
// picks if the embedding vectors still haven't arrived.
const REC_EMBEDDINGS_TIMEOUT_MS = 30000;

export default function Recommendations({ onOpenRec, onOpenInsights, onOpenTrain, onOpenRate }) {
  const rt = useStore();
  const trackRef = useRef(null);
  const appendRaf = useRef(0);
  const [embeddingsTimedOut, setEmbeddingsTimedOut] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [calcTrigger, setCalcTrigger] = useState(0);
  const isRefreshingRef = useRef(false);

  // Hold on the skeleton shimmer until embeddings land (or we give up waiting)
  // so the first picks the viewer sees are embedding-powered, not popularity
  // placeholders. Mirrors the original single-file app's first-load behaviour.
  const embeddingsPending = !rt.recommendationManifest
    && rt.recommendationStatus !== 'error'
    && rt.recommendationStatus !== 'idle'
    && !embeddingsTimedOut;

  useEffect(() => {
    if (!embeddingsPending) return undefined;
    const t = setTimeout(() => setEmbeddingsTimedOut(true), REC_EMBEDDINGS_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [embeddingsPending]);

  useEffect(() => () => { if (appendRaf.current) cancelAnimationFrame(appendRaf.current); }, []);

  const dataStatus = recommendationDataStatus();
  const [recs, setRecs] = useState({ list: [], personalised: false, totalAvailable: 0 });
  const [isCalculating, setIsCalculating] = useState(false);

  const depMovies = rt.state?.movies;
  const depVectors = rt.state?.peerVectors;
  const depGenres = rt.activeSelectedGenres;
  const depLanguages = rt.activeSelectedLanguages;

  useEffect(() => {
    if (embeddingsPending) return;

    setIsCalculating(true);
    const t = setTimeout(() => {
      const result = getRecommendations({ forceRefresh: isRefreshingRef.current });
      setRecs(result);
      setIsCalculating(false);
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }, 150);

    return () => clearTimeout(t);
  }, [
    depGenres,
    depLanguages,
    embeddingsPending,
    calcTrigger
  ]);

  const genreOptions = useMemo(() => {
    const s = new Set();
    for (const m of rt.MOVIE_DB) (m.genres || []).forEach((g) => { if (g && g !== 'Unknown') s.add(g); });
    return [...s].sort((a, b) => a.localeCompare(b)).map((g) => ({ value: g, label: g }));
  }, [rt.MOVIE_DB]);

  const languageOptions = useMemo(() => {
    const s = new Set();
    for (const m of rt.MOVIE_DB) if (m.language) s.add(m.language);
    return [...s]
      .map((code) => {
        const info = LANGUAGE_INFO[code];
        return { value: code, label: info ? `${info.flag} ${info.name}` : code.toUpperCase() };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rt.MOVIE_DB]);

  // Changing a filter rebuilds the carousel from the top rather than appending.
  const applyFilterChange = () => {
    markRankingStale();
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setCalcTrigger((v) => v + 1);
  };
  const setGenres = (next) => { rt.activeSelectedGenres = next; applyFilterChange(); };
  const setLanguages = (next) => { rt.activeSelectedLanguages = next; applyFilterChange(); };

  const forceRefresh = () => {
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setCalcTrigger((v) => v + 1);
  };

  // Infinite scroll: when the carousel nears its right edge, append the next
  // batch of recommendations so it keeps loading more as the user scrolls.
  const maybeAppend = () => {
    const el = trackRef.current;
    if (!el || shimmer || isCalculating) return;
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
    if (remaining > 320) return;
    const before = recs.list.length;
    const after = appendRecommendations();
    if (after.list.length !== before) {
      setRecs(prev => ({ ...prev, list: after.list, totalAvailable: after.totalAvailable }));
    }
  };

  const onTrackScroll = () => {
    if (appendRaf.current) return;
    appendRaf.current = requestAnimationFrame(() => {
      appendRaf.current = 0;
      maybeAppend();
    });
  };

  const scrollNext = () => {
    trackRef.current?.scrollBy({ left: 280, behavior: 'smooth' });
    maybeAppend();
  };

  // ---- rec-card actions ----
  const movies = rt.state?.movies || [];
  const myCount = movies.filter((m) => m.by === rt.myId).length;
  const canNominate = rt.state?.phase === 'lobby' && myCount < MAX_NOMINATIONS;

  const onNominate = (m) => {
    actions.nominate(m.title, m.id || m.tmdbId);
    addRecentlyNominated(m.title);
    const updated = replaceRecommendation(m.title);
    setRecs({ list: updated.list, personalised: updated.personalised, totalAvailable: updated.totalAvailable });
    emit();
  };
  const onWatchlist = (m) => {
    if (inWatchlist(m.title)) removeFromWatchlist(m.title);
    else addToWatchlist(m.title);
    afterTasteChange();
  };
  // Dismissing a card swaps in just the next recommendation rather than
  // rebuilding the whole carousel, so the other cards stay put.
  const onNotInterested = (m) => {
    markNotInterested(m.title);
    const updated = replaceRecommendation(m.title);
    setRecs({ list: updated.list, personalised: updated.personalised, totalAvailable: updated.totalAvailable });
    afterTasteChange();
  };
  const onWatched = (m) => onOpenRate?.(m.title);

  const shimmer = embeddingsPending || isRefreshing || isCalculating;

  return (
    <section className="card p-4 sm:p-5 min-w-0">
      <div className="flex flex-wrap items-center gap-2.5 mb-3">
        <h2 className="text-lg font-semibold text-white mr-auto">Recommendations</h2>
        <button type="button" className="btn btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold text-white" onClick={onOpenTrain}>
          <i className="fa-solid fa-wand-magic-sparkles mr-1" />Improve
        </button>
        <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={onOpenInsights}>Insights</button>
        <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={forceRefresh}>
          <i className="fa-solid fa-rotate-right mr-1" />Refresh
        </button>
        {dataStatus && (
          <span className="text-xs text-slate-300 inline-flex items-center gap-1.5" title={dataStatus.message}>
            <span className={`dot ${dataStatus.level === 'loading' ? 'pulse' : ''} ${dataStatus.level === 'error' ? 'bg-rose-400' : 'bg-amber-400'}`} />
            {dataStatus.level}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <MultiSelect
          icon="fa-solid fa-masks-theater"
          allText="All genres"
          countSuffix="genres"
          options={genreOptions}
          selected={rt.activeSelectedGenres}
          onChange={setGenres}
        />
        <MultiSelect
          icon="fa-solid fa-language"
          allText="All languages"
          countSuffix="languages"
          options={languageOptions}
          selected={rt.activeSelectedLanguages}
          onChange={setLanguages}
        />
      </div>

      {rt.hasPendingGroupUpdates && (
        <div className="mb-3 px-3.5 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-300 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            Group taste updated. Refresh to re-score recommendations.
          </span>
          <button 
            type="button" 
            className="btn px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 border-0 cursor-pointer" 
            onClick={() => {
              rt.hasPendingGroupUpdates = false;
              forceRefresh();
            }}
          >
            Refresh
          </button>
        </div>
      )}

      <div className="relative">
        <button type="button" className="rec-nav rec-prev" onClick={() => trackRef.current?.scrollBy({ left: -280, behavior: 'smooth' })} aria-label="Previous recommendations">
          <i className="fa-solid fa-chevron-left" />
        </button>
        <button type="button" className="rec-nav rec-next" onClick={scrollNext} aria-label="Next recommendations">
          <i className="fa-solid fa-chevron-right" />
        </button>

        <div className="rec-track" ref={trackRef} role="list" aria-label="Recommended movies" onScroll={onTrackScroll}>
          {shimmer && Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rec-card rec-shimmer" aria-hidden="true">
              <div className="relative overflow-hidden rounded-t-xl">
                <div className="shimmer-block shimmer-poster" />
              </div>
              <div className="p-2 flex flex-col gap-2 flex-1">
                <div className="shimmer-block" style={{ height: 12, width: '85%' }} />
                <div className="shimmer-block" style={{ height: 12, width: '55%' }} />
                <div className="mt-auto flex flex-col gap-1.5">
                  <div className="shimmer-block" style={{ height: 26, width: '100%' }} />
                  <div className="shimmer-block" style={{ height: 26, width: '100%' }} />
                </div>
              </div>
            </div>
          ))}

          {!shimmer && recs.list.map((rec) => (
            <RecCard
              key={`${rec.movie.id || rec.movie.title}-${rec.score}`}
              rec={rec}
              onOpen={onOpenRec}
              onNominate={onNominate}
              onWatchlist={onWatchlist}
              onWatched={onWatched}
              onNotInterested={onNotInterested}
              canNominate={canNominate}
              onWatchlistState={inWatchlist(rec.movie.title)}
              onWatchedState={!!findWatched(rec.movie.title)}
            />
          ))}

          {!shimmer && recs.list.length === 0 && (
            <div className="text-sm text-slate-400 px-1 py-4">No matches yet. Try clearing filters or adding more watched/rated titles.</div>
          )}
        </div>
      </div>

      <div className="mt-2 text-xs text-slate-400">
        {shimmer
          ? 'Personalising…'
          : `${recs.personalised ? 'Personalised picks' : 'Popularity-first picks'} · ${recs.totalAvailable} candidates`}
      </div>
    </section>
  );
}
