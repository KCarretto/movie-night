import { useMemo, useState } from 'react';
import { MAX_NOMINATIONS } from '../lib/constants.js';
import { movieMeta } from '../lib/catalog.js';
import { addRecentlyNominated } from '../lib/storage.js';
import GenreTags from '../ui/GenreTags.jsx';
import LanguageBadge from '../ui/LanguageBadge.jsx';
import SeenIndicator from '../ui/SeenIndicator.jsx';
import Poster from '../ui/Poster.jsx';
import Typeahead from './Typeahead.jsx';
import { actions } from '../state/controller.js';
import { useStore } from '../state/useStore.js';

export default function Nominate({ onOpenStartVote }) {
  const rt = useStore();
  const [query, setQuery] = useState('');
  const movies = rt.state?.movies || [];
  const myId = rt.myId;
  const myCount = movies.filter((m) => m.by === myId).length;
  const canNominate = rt.state?.phase === 'lobby' && myCount < MAX_NOMINATIONS;

  const byName = useMemo(() => new Map((rt.state?.peers || []).map((p) => [p.id, p.name])), [rt.state?.peers]);

  const nominate = (m) => {
    if (!m?.title || !canNominate) return;
    actions.nominate(m.title, m.id || m.tmdb_id);
    addRecentlyNominated(m.title);
    setQuery('');
  };

  const submit = (e) => {
    e.preventDefault();
    const text = query.trim();
    if (!text || !canNominate) return;
    const mm = movieMeta(text);
    actions.nominate(text, mm?.id || mm?.tmdb_id);
    addRecentlyNominated(text);
    setQuery('');
  };

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-white mr-auto">Nominate movies</h2>
        <span className="text-xs text-slate-400">Your picks: {myCount}/{MAX_NOMINATIONS}</span>
      </div>

      <form onSubmit={submit} className="space-y-2 mb-3">
        <Typeahead value={query} onChange={setQuery} onPick={nominate} />
        <div className="flex items-center justify-between gap-2">
          <button type="submit" disabled={!canNominate} className="btn btn-primary px-3 py-2 rounded-lg text-sm text-white disabled:opacity-50">
            Add nomination
          </button>
          <div className="text-xs text-slate-400">Need at least 2 choices to start voting.</div>
        </div>
      </form>

      <div className="space-y-2.5">
        {movies.map((m, i) => {
          const meta = movieMeta(m.title, m.tmdbId);
          return (
            <div key={m.id} className="rounded-lg border border-line bg-panel2 p-2.5">
              <div className="flex items-start gap-2">
                <div className="text-xs text-slate-500 mt-1">#{i + 1}</div>
                <Poster movie={meta || m} className="w-10 h-14 rounded flex-none" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-100 truncate">{m.title}</div>
                  <div className="text-xs text-slate-400">by {byName.get(m.by) || 'Guest'}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {meta ? <GenreTags movie={meta} /> : null}
                    {meta ? <LanguageBadge movie={meta} /> : null}
                    <SeenIndicator title={m.title} />
                  </div>
                </div>
                {m.by === myId && rt.state?.phase === 'lobby' && (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-rose-300"
                    aria-label="Remove nomination"
                    onClick={() => actions.removeNomination(m.id)}
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {movies.length === 0 && <div className="text-sm text-slate-400">No nominations yet.</div>}
      </div>

      <div className="mt-3">
        {rt.isHost ? (
          <button
            type="button"
            className="btn btn-accent2 px-3 py-2 rounded-lg text-sm text-white disabled:opacity-50"
            disabled={movies.length < 2}
            onClick={onOpenStartVote}
          >
            Lock nominations & start voting
          </button>
        ) : (
          <div className="text-xs text-slate-400">Waiting for host to start voting.</div>
        )}
      </div>
    </section>
  );
}
