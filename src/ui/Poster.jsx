import React from "react";
import { useMemo, useState } from 'react';

export default function Poster({ movie, title, className = '', alt = '', onClick }) {
  const [broken, setBroken] = useState(false);
  const label = title || movie?.title || 'Movie';
  const art = movie?.art || '';
  const fallback = useMemo(() => String(label).trim().charAt(0).toUpperCase() || '🎬', [label]);

  return (
    <div
      className={`poster relative overflow-hidden ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick(e) : undefined}
    >
      {!broken && art ? (
        <img
          src={art}
          alt={alt || `${label} poster`}
          className="w-full h-full poster"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-3xl font-display text-slate-400">
          {fallback}
        </div>
      )}
    </div>
  );
}
