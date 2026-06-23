import { starParts } from '../lib/format.js';

export default function Stars({ rating = 0, className = '' }) {
  const parts = starParts(rating);
  return (
    <span className={`rating-stars inline-flex items-center gap-0.5 ${className}`.trim()} aria-label={`${rating} stars`}>
      {parts.map((p, idx) => {
        const cls = p === 'full'
          ? 'fa-solid fa-star text-gold'
          : p === 'half'
            ? 'fa-solid fa-star-half-stroke text-gold'
            : 'fa-regular fa-star text-slate-500';
        return <i key={idx} className={cls} aria-hidden="true" />;
      })}
    </span>
  );
}
