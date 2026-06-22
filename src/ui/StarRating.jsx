import { useMemo, useRef, useState } from 'react';
import { starParts } from '../lib/format.js';

export default function StarRating({ value = 0, onChange, size = 'text-xl' }) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const shown = hover ?? value;
  const parts = useMemo(() => starParts(shown), [shown]);

  const pick = (e, idx) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const half = (e.clientX - rect.left) < rect.width / 2;
    onChange?.(idx + (half ? 0.5 : 1));
  };

  const hoverPick = (e, idx) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const half = (e.clientX - rect.left) < rect.width / 2;
    setHover(idx + (half ? 0.5 : 1));
  };

  return (
    <div ref={wrapRef} className="flex items-center gap-2" onMouseLeave={() => setHover(null)}>
      <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {parts.map((part, i) => {
          const cls = part === 'full'
            ? 'fa-solid fa-star text-gold'
            : part === 'half'
              ? 'fa-solid fa-star-half-stroke text-gold'
              : 'fa-regular fa-star text-slate-500';
          return (
            <button
              key={i}
              type="button"
              className={`${size} leading-none`}
              onMouseMove={(e) => hoverPick(e, i)}
              onClick={(e) => pick(e, i)}
              aria-label={`Rate ${i + 1} stars`}
            >
              <i className={cls} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="text-xs text-slate-400 hover:text-slate-200"
        onClick={() => onChange?.(0)}
      >
        Clear
      </button>
    </div>
  );
}
