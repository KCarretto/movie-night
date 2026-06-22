import LanguageBadge from '../ui/LanguageBadge.jsx';
import Poster from '../ui/Poster.jsx';
import RatingsLine from '../ui/RatingsLine.jsx';

export default function RecCard({ rec, onOpen }) {
  const m = rec.movie;
  return (
    <article className="rec-card relative" onClick={() => onOpen?.(rec)}>
      {rec.isNew && <span className="rec-badge">NEW</span>}
      {rec.fromWatchlist && <span className="rec-badge" style={{ left: 'auto', right: 8, background: 'rgba(255,61,110,.92)' }}>WL</span>}
      <Poster movie={m} className="rec-poster" />
      <div className="p-2.5 space-y-1.5">
        <div className="rec-title text-sm font-medium text-slate-100" title={m.title}>{m.title}</div>
        <div className="text-xs text-slate-400">{m.year || '—'}</div>
        <LanguageBadge movie={m} />
        <RatingsLine movie={m} />
      </div>
    </article>
  );
}
