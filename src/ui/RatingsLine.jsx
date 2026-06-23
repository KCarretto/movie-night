import { ratingBits } from '../lib/format.js';

export default function RatingsLine({ movie }) {
  const bits = ratingBits(movie);
  if (!bits.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {bits.map((b, i) => {
        let label = '';
        if (b.kind === 'imdb') label = `IMDb ${Number(b.value).toFixed(1)}`;
        else if (b.kind === 'rt') label = `🍅 ${Math.round(Number(b.value))}%`;
        else label = `📊 ${Number(b.value).toFixed(1)}`;
        return (
          <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-panel2 border border-line text-slate-300">
            {label}
          </span>
        );
      })}
    </div>
  );
}
