import LanguageBadge from '../ui/LanguageBadge.jsx';
import Poster from '../ui/Poster.jsx';
import RatingsLine from '../ui/RatingsLine.jsx';
import SeenIndicator from '../ui/SeenIndicator.jsx';

export default function RecCard({
  rec, onOpen, onNominate, onWatchlist, onWatched, onNotInterested,
  canNominate = false, onWatchlistState = false,
}) {
  const m = rec.movie;
  // Stop a button click from also bubbling to the card's "open detail" handler.
  const guard = (fn) => (e) => { e.stopPropagation(); fn?.(); };

  return (
    <article
      className="rec-card relative"
      role="listitem"
      tabIndex={0}
      aria-label={`View details for ${m.title}`}
      onClick={() => onOpen?.(rec)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(rec); } }}
    >
      <div className="relative overflow-hidden rounded-t-xl">
        <Poster movie={m} className="rec-poster" />
        {rec.isNew && <span className="rec-badge">NEW</span>}
        {rec.fromWatchlist && <span className="rec-badge" style={{ left: 'auto', right: 8, background: 'rgba(255,61,110,.92)' }}>WL</span>}
      </div>
      <div className="p-2 flex flex-col gap-1 flex-1">
        <div className="rec-title text-xs font-medium leading-snug text-slate-100" title={m.title}>
          {m.title}
          {m.year ? <span className="text-slate-500"> ({m.year})</span> : null}
        </div>
        <div className="mt-auto space-y-1">
          <div className="flex items-center gap-1 flex-wrap text-[11px]">
            <SeenIndicator title={m.title} />
            <LanguageBadge movie={m} />
          </div>
          <RatingsLine movie={m} />
          <button
            type="button"
            className={`rec-nominate btn w-full text-xs font-semibold py-1.5 rounded-lg ${canNominate ? 'btn-primary text-white' : 'opacity-40 cursor-not-allowed'}`}
            disabled={!canNominate}
            onClick={guard(() => onNominate?.(m))}
          >
            <i className="fa-solid fa-plus mr-1" />Nominate
          </button>
          <button
            type="button"
            className={`rec-watchlist btn w-full text-xs font-semibold py-1.5 rounded-lg bg-panel2 border ${onWatchlistState ? 'border-emerald-500/40 text-emerald-300' : 'border-line text-slate-300'}`}
            aria-pressed={onWatchlistState ? 'true' : 'false'}
            onClick={guard(() => onWatchlist?.(m))}
          >
            <i className={`fa-${onWatchlistState ? 'solid' : 'regular'} fa-bookmark mr-1`} />
            {onWatchlistState ? 'Added to Watchlist' : 'Add to Watchlist'}
          </button>
          <div className="flex gap-1">
            <button
              type="button"
              className="rec-watched btn flex-1 text-[10px] leading-tight font-semibold py-1.5 px-1 rounded-lg bg-panel2 border border-line text-slate-300"
              onClick={guard(() => onWatched?.(m))}
            >
              <i className="fa-regular fa-circle-check mr-0.5" />Watched
            </button>
            <button
              type="button"
              className="rec-not-interested btn flex-1 text-[10px] leading-tight font-semibold py-1.5 px-1 rounded-lg bg-panel2 border border-line text-slate-300"
              onClick={guard(() => onNotInterested?.(m))}
            >
              <i className="fa-solid fa-thumbs-down mr-0.5" />Not Interested
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
