import { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Poster from '../ui/Poster.jsx';
import { useStore } from '../state/useStore.js';
import { afterTasteChange } from '../state/controller.js';
import {
  addToWatchlist, markNotInterested, markNotSure, upsertInterested,
  loadWatchlist, loadNotInterested, loadInterested, loadNotSure, loadWatched
} from '../lib/storage.js';
import { getRecommendations, markRankingStale, appendRecommendations } from '../lib/recengine.js';
import { normTitle } from '../lib/format.js';
import { emit } from '../lib/runtime.js';

export default function TrainModal({ open, onClose, onRate }) {
  const rt = useStore();
  const [sessionReviewed, setSessionReviewed] = useState(new Set());

  // Re-calculate the combined skip set on each render to catch fresh storage state
  const skipSet = useMemo(() => {
    if (!open) return new Set();
    const set = new Set(sessionReviewed);
    loadWatchlist().forEach((w) => set.add(normTitle(w.title)));
    loadNotInterested().forEach((w) => set.add(normTitle(w.title)));
    loadInterested().forEach((w) => set.add(normTitle(w.title)));
    loadNotSure().forEach((w) => set.add(normTitle(w.title)));
    loadWatched().forEach((w) => set.add(normTitle(w.title)));
    return set;
  }, [open, sessionReviewed]);

  const [movie, unreviewedCount] = useMemo(() => {
    if (!open) return [null, 0];

    // Scan recommendations first
    const recs = getRecommendations().list.map((r) => r.movie);
    const unreviewed = recs.filter((m) => !skipSet.has(normTitle(m.title)));

    let first = unreviewed[0];
    const count = unreviewed.length;

    // If we run out in recommendations, fallback to DB
    if (!first) {
      const extra = rt.MOVIE_DB.filter((m) => m?.art && !skipSet.has(normTitle(m.title)));
      first = extra[0] || null;
    }

    return [first, count];
  }, [open, skipSet, rt.MOVIE_DB.length]);

  // Fetch more if we're running low on unreviewed recommendations
  useEffect(() => {
    if (open && unreviewedCount < 5) {
      const before = getRecommendations().list.length;
      const after = appendRecommendations();
      if (after.list.length !== before) emit();
    }
  }, [open, unreviewedCount]);

  const bump = (title) => {
    setSessionReviewed((prev) => {
      const next = new Set(prev);
      next.add(normTitle(title));
      return next;
    });
  };

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
            <button type="button" className="btn btn-primary px-3 py-2 rounded-lg text-sm text-white" onClick={() => { addToWatchlist(movie.title); tasteTouch(); bump(movie.title); }}>Want to watch</button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => { upsertInterested(movie.title, 4); tasteTouch(); bump(movie.title); }}>Interested</button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => { markNotInterested(movie.title); tasteTouch(); bump(movie.title); }}>Not for me</button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => { markNotSure(movie.title); tasteTouch(); bump(movie.title); }}>Not sure</button>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-line/50">
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => { onRate?.(movie.title); bump(movie.title); }}>I’ve seen this</button>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => bump(movie.title)}>Skip</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
