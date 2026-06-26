import { useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Poster from '../ui/Poster.jsx';
import { useStore } from '../state/useStore.js';
import { afterTasteChange } from '../state/controller.js';
import { addToWatchlist, markNotInterested, markNotSure, upsertInterested } from '../lib/storage.js';
import { getRecommendations, markRankingStale } from '../lib/recengine.js';

export default function TrainModal({ open, onClose, onRate }) {
  const rt = useStore();
  const [idx, setIdx] = useState(0);
  const picks = useMemo(() => {
    // Only build the training set while the modal is actually open. The
    // component stays mounted, so keying off `open` previously triggered the
    // expensive recommendation recompute on both open and close — making the
    // button feel slow to toggle. Reuse the already-precomputed ranking (no
    // forceRefresh) so opening is instant, and skip all work when closed.
    if (!open) return [];
    const base = getRecommendations().list.map((r) => r.movie);
    if (base.length >= 12) return base.slice(0, 12);
    const extra = rt.MOVIE_DB.slice(0, 20).filter((m) => m?.art);
    return [...base, ...extra].slice(0, 12);
  }, [open, rt.MOVIE_DB.length]);

  const movie = picks[idx] || null;
  const bump = () => setIdx((n) => (n + 1 >= picks.length ? 0 : n + 1));
  const tasteTouch = () => { markRankingStale(); afterTasteChange(); };

  return (
    <Modal open={open} onClose={onClose} title="Train recommendations">
      {!movie ? (
        <div className="text-sm text-slate-400">No training cards available yet.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-3">
            <Poster movie={movie} className="w-24 shrink-0 h-36 rounded-lg overflow-hidden" />
            <div>
              <div className="text-white font-medium">{movie.title}</div>
              <div className="text-xs text-slate-400">{movie.year || '—'} · {movie.primaryGenre || '—'}</div>
              <p className="text-sm text-slate-300 mt-2 line-clamp-5">{movie.description || 'No description.'}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary px-3 py-2 rounded-lg text-sm text-white" onClick={() => { addToWatchlist(movie.title); tasteTouch(); bump(); }}>Want to watch</button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => { upsertInterested(movie.title, 4); tasteTouch(); bump(); }}>Interested</button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => { markNotInterested(movie.title); tasteTouch(); bump(); }}>Not for me</button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => { markNotSure(movie.title); tasteTouch(); bump(); }}>Not sure</button>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-line/50">
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => { onRate?.(movie.title); bump(); }}>I’ve seen this</button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={bump}>Skip</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
