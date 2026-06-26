import { useMemo, useState } from 'react';
import { useStore } from '../state/useStore.js';
import Poster from '../ui/Poster.jsx';

export default function Typeahead({ value, onChange, onPick }) {
  const rt = useStore();
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q || rt.MOVIE_DB.length === 0) return [];
    const scored = [];
    for (const m of rt.MOVIE_DB) {
      if (!m?.title) continue;
      const t = m.title.toLowerCase();
      const idx = t.indexOf(q);
      if (idx === -1) continue;
      const score = idx === 0 ? 0 : idx + (m.year ? 0.01 : 0.2);
      scored.push({ movie: m, score });
      if (scored.length > 120) break;
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 8).map((s) => s.movie);
  }, [q, rt.MOVIE_DB]);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          setActive(0);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((v) => (v + 1) % results.length); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((v) => (v - 1 + results.length) % results.length); }
          if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            onPick?.(results[active]);
          }
        }}
        className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm"
        placeholder="Search movie title…"
        aria-label="Movie title"
      />
      {results.length > 0 && (
        <div className="typeahead card p-1">
          {results.map((m, i) => (
            <button
              key={`${m.id}-${m.title}`}
              type="button"
              className={`ta-item flex items-center gap-2 w-full text-left px-2.5 py-2 rounded-md text-sm ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick?.(m)}
            >
              <Poster movie={m} className="w-8 h-12 rounded flex-none" />
              <div className="flex-1 min-w-0 truncate">
                <span className="text-slate-100">{m.title}</span>
                {m.year ? <span className="text-slate-400"> · {m.year}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
