import { useMemo } from 'react';
import Modal from '../ui/Modal.jsx';
import { getRecommendations, computeMyCentroids } from '../lib/recengine.js';
import { movieEmbedding } from '../lib/embeddings.js';
import { nearestCentroid, pca2d } from '../lib/vector.js';

const COLORS = ['#7c5cff', '#ff3d6e', '#22d3ee', '#f59e0b', '#10b981', '#e879f9'];

export default function InsightsModal({ open, onClose }) {
  const data = useMemo(() => {
    const centroids = computeMyCentroids();
    const list = getRecommendations().list;
    const points = [];
    list.forEach((rec) => {
      const emb = movieEmbedding(rec.movie);
      if (!emb) return;
      const near = centroids.length ? nearestCentroid(emb, centroids) : { index: -1, sim: 0 };
      points.push({ title: rec.movie.title, emb: Array.from(emb), cluster: near.index, sim: near.sim });
    });
    if (points.length < 2) return null;
    const xy = pca2d(points.map((p) => p.emb));
    const xs = xy.map((p) => p[0]);
    const ys = xy.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return points.map((p, i) => ({
      ...p,
      x: ((xy[i][0] - minX) / Math.max(1e-6, maxX - minX)) * 92 + 4,
      y: ((xy[i][1] - minY) / Math.max(1e-6, maxY - minY)) * 92 + 4,
    }));
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Taste insights" className="max-w-3xl">
      {!data ? (
        <p className="text-sm text-slate-400">Not enough embedding data yet. Add ratings/watchlist and refresh recommendations.</p>
      ) : (
        <div className="space-y-3">
          <svg viewBox="0 0 100 100" className="insights-svg border border-line">
            {data.map((p, i) => {
              const c = p.cluster >= 0 ? COLORS[p.cluster % COLORS.length] : '#94a3b8';
              return (
                <g key={`${p.title}-${i}`} className="insights-node" data-title={p.title}>
                  <circle cx={p.x} cy={p.y} r="2.2" fill={c} />
                  <title>{p.title}</title>
                </g>
              );
            })}
          </svg>
          <div className="grid sm:grid-cols-2 gap-2">
            {data.slice(0, 14).map((p, i) => (
              <div key={`${p.title}-row-${i}`} className="text-xs text-slate-300 flex items-center gap-2">
                <span className="insights-legend-dot" style={{ background: p.cluster >= 0 ? COLORS[p.cluster % COLORS.length] : '#94a3b8' }} />
                <span className="truncate">{p.title}</span>
                <span className="text-slate-500 ml-auto">{Number(p.sim || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
