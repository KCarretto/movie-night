import Modal from '../ui/Modal.jsx';
import Poster from '../ui/Poster.jsx';
import GenreTags from '../ui/GenreTags.jsx';
import LanguageBadge from '../ui/LanguageBadge.jsx';
import RatingsLine from '../ui/RatingsLine.jsx';
import StarRating from '../ui/StarRating.jsx';
import { actions, afterTasteChange, shareSeen } from '../state/controller.js';
import {
  addToWatchlist, inWatchlist, loadInterested, loadNotInterested,
  markNotInterested, removeFromWatchlist, upsertInterested,
} from '../lib/storage.js';
import { markRankingStale } from '../lib/recengine.js';

export default function RecDetailModal({ open, rec, onClose, onRate }) {
  const m = rec?.movie;
  if (!m) return null;
  const watchlisted = inWatchlist(m.title);
  const interested = loadInterested().find((x) => x.title.toLowerCase() === m.title.toLowerCase());
  const skipped = loadNotInterested().some((x) => x.title.toLowerCase() === m.title.toLowerCase());

  const tasteTouch = () => {
    markRankingStale();
    afterTasteChange();
  };

  return (
    <Modal open={open} onClose={onClose} title={m.title} className="max-w-2xl">
      <div className="flex flex-col sm:flex-row gap-4">
        <Poster movie={m} className="w-36 h-52 rounded-lg overflow-hidden mx-auto sm:mx-0" />
        <div className="space-y-2 min-w-0">
          <div className="text-sm text-slate-300">{m.year || '—'} · {m.runtime || '—'} min</div>
          <RatingsLine movie={m} />
          <div className="flex flex-wrap gap-1.5">
            <LanguageBadge movie={m} />
            <GenreTags movie={m} />
          </div>

          <div className="text-sm text-slate-300 space-y-1">
            {m.director?.length > 0 && <div><strong>Director:</strong> {Array.isArray(m.director) ? m.director.join(', ') : m.director}</div>}
            {m.cast?.length > 0 && <div><strong>Cast:</strong> {Array.isArray(m.cast) ? m.cast.join(', ') : m.cast}</div>}
          </div>

          <p className="text-sm text-slate-300">{m.description || 'No description available.'}</p>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn btn-accent2 px-3 py-2 rounded-lg text-sm text-white" onClick={() => actions.nominate(m.title, m.id || m.tmdb_id)}>
              Nominate
            </button>
            <button
              type="button"
              className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm"
              onClick={() => { if (watchlisted) removeFromWatchlist(m.title); else addToWatchlist(m.title); tasteTouch(); }}
            >
              {watchlisted ? 'Remove watchlist' : 'Add watchlist'}
            </button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => onRate?.(m.title)}>
              Mark watched
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StarRating
              value={interested?.interest || 0}
              onChange={(n) => {
                if (n > 0) {
                  upsertInterested(m.title, n);
                  tasteTouch();
                  onClose();
                }
              }}
            />
            <button
              type="button"
              className={`text-xs px-2 py-1 rounded-full border ml-2 ${skipped ? 'border-rose-400 text-rose-300' : 'border-line text-slate-300'}`}
              onClick={() => { markNotInterested(m.title); tasteTouch(); onClose(); }}
            >
              Not interested
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
