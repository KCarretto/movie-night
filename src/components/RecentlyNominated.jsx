import React, { useMemo } from 'react';
import { loadRecentlyNominated, addRecentlyNominated } from '../lib/storage.js';
import { movieMeta } from '../lib/catalog.js';
import Poster from '../ui/Poster.jsx';
import GenreTags from '../ui/GenreTags.jsx';
import LanguageBadge from '../ui/LanguageBadge.jsx';
import SeenIndicator from '../ui/SeenIndicator.jsx';
import { actions } from '../state/controller.js';
import { useStore } from '../state/useStore.js';
import { MAX_NOMINATIONS } from '../lib/constants.js';

export default function RecentlyNominated({ onOpenInfo }) {
  const rt = useStore();
  const movies = rt.state?.movies || [];
  const myCount = movies.filter((m) => m.by === rt.myId).length;
  const canNominate = rt.state?.phase === 'lobby' && myCount < MAX_NOMINATIONS;

  const recent = useMemo(() => {
    return loadRecentlyNominated().map(title => movieMeta(title)).filter(Boolean).slice(0, 15);
  }, [rt.state?.movies, rt.movieDbStatus]); // Re-compute if movies change or database finishes loading

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-white mr-auto">Recently Nominated</h2>
      </div>
      {recent.length === 0 ? (
        <div className="text-xs text-slate-400 py-4 text-center border border-dashed border-line/60 rounded-xl px-4">
          No recent nominations yet. Movies you nominate will appear here for quick access in future sessions.
        </div>
      ) : (
        <div className="flex overflow-x-auto gap-3 pb-2 -mx-2 px-2 snap-x">
          {recent.map((meta, idx) => {
            const isNominated = movies.some(m => m.title && meta.title && m.title.toLowerCase() === meta.title.toLowerCase());
            return (
              <div key={meta.id || idx} className="w-32 flex-none snap-start relative group">
                <Poster movie={meta} className="w-32 h-48 rounded-lg shadow-md cursor-pointer" onClick={() => onOpenInfo(meta)} />
                <div className="mt-2 text-sm text-slate-100 font-medium truncate">{meta.title}</div>
                <div className="text-xs text-slate-400 truncate">{meta.year}</div>
                {!isNominated && canNominate && (
                  <button
                    type="button"
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white hover:bg-black/80 flex items-center justify-center backdrop-blur shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.nominate(meta.title, meta.id || meta.tmdb_id);
                      addRecentlyNominated(meta.title);
                    }}
                    title="Nominate again"
                  >
                    <i className="fa-solid fa-plus text-sm" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
