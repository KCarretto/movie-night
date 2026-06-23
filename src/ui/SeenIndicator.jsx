import { useMemo, useState } from 'react';
import { normTitle } from '../lib/format.js';
import { useStore } from '../state/useStore.js';

export default function SeenIndicator({ title }) {
  const rt = useStore();
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    const t = normTitle(title);
    const peers = rt.state?.peers || [];
    const byId = new Map(peers.map((p) => [p.id, p.name]));
    const seen = rt.state?.seen || {};
    const out = [];
    Object.entries(seen).forEach(([pid, list]) => {
      const hit = (Array.isArray(list) ? list : []).find((x) => normTitle(x?.title) === t);
      if (hit) out.push({ name: byId.get(pid) || 'Guest', rating: Number(hit.rating) || 0 });
    });
    return out;
  }, [rt.state?.seen, rt.state?.peers, title]);

  if (!rows.length) return null;
  return (
    <span className={`seen-wrap ${open ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="text-xs text-slate-300 hover:text-white"
        onClick={() => setOpen((v) => !v)}
        aria-label="Seen by"
      >
        👀 {rows.length}
      </button>
      <div className="seen-pop card p-2 text-xs" role="tooltip">
        <div className="text-slate-300 mb-1">Seen by</div>
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-center justify-between gap-2">
              <span>{r.name}</span>
              <span className="text-slate-400">{r.rating ? `${r.rating.toFixed(1)}★` : 'unrated'}</span>
            </li>
          ))}
        </ul>
      </div>
    </span>
  );
}
