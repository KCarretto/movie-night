import React from 'react';
import { movieMeta } from '../lib/catalog.js';
import Poster from '../ui/Poster.jsx';
import GenreTags from '../ui/GenreTags.jsx';
import LanguageBadge from '../ui/LanguageBadge.jsx';
import { actions, afterTasteChange } from '../state/controller.js';
import { useStore } from '../state/useStore.js';
import { inWatchlist, addToWatchlist, removeFromWatchlist } from '../lib/storage.js';

export default function MyNominations({ onOpenInfo }) {
  const rt = useStore();
  const movies = rt.state?.movies || [];
  const myId = rt.myId;
  const myNominations = movies.filter((m) => m.by === myId);

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-lg font-semibold text-white">My Nominations</h2>
        <span className="text-xs text-slate-400">
          {myNominations.length} nominated
        </span>
      </div>

      {myNominations.length === 0 ? (
        <div className="text-xs text-slate-400 py-4 text-center border border-dashed border-line/60 rounded-xl px-4">
          You haven't nominated any movies in this room yet. Use the card above to add yours.
        </div>
      ) : (
        <div className="space-y-2.5">
          {myNominations.map((m, i) => {
            const meta = movieMeta(m.title, m.tmdbId);
            const inWl = inWatchlist(m.title);
            return (
              <div key={m.id} className="rounded-lg border border-line bg-panel2 p-2.5">
                <div className="flex items-start gap-2">
                  <div className="text-xs text-slate-500 mt-1">#{i + 1}</div>
                  <Poster movie={meta || m} className="w-10 h-14 rounded flex-none cursor-pointer" onClick={() => onOpenInfo?.(meta || m)} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-100 truncate">{m.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {meta ? <GenreTags movie={meta} /> : null}
                      {meta ? <LanguageBadge movie={meta} /> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-none self-start">
                    <button
                      type="button"
                      className={`p-1 rounded-lg transition-colors ${
                        inWl
                          ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                      }`}
                      title={inWl ? 'Remove from Watchlist' : 'Add to Watchlist'}
                      aria-label={inWl ? 'Remove from Watchlist' : 'Add to Watchlist'}
                      onClick={() => {
                        if (inWl) {
                          removeFromWatchlist(m.title);
                        } else {
                          addToWatchlist(m.title);
                        }
                        afterTasteChange();
                      }}
                    >
                      <i className={`${inWl ? 'fa-solid' : 'fa-regular'} fa-bookmark text-xs`} />
                    </button>
                    {rt.state?.phase === 'lobby' && (
                      <button
                        type="button"
                        className="text-slate-400 hover:text-rose-300 p-1"
                        aria-label="Remove nomination"
                        onClick={() => actions.removeNomination(m.id)}
                      >
                        <i className="fa-solid fa-trash text-xs" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
