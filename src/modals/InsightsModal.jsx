import { useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Poster from '../ui/Poster.jsx';
import { runtime } from '../lib/runtime.js';
import { buildTasteProfile, getRecCache } from '../lib/recengine.js';
import { movieEmbedding } from '../lib/embeddings.js';
import { movieMeta } from '../lib/catalog.js';
import { isVector, normTitle } from '../lib/format.js';
import { nearestCentroid, pca2d } from '../lib/vector.js';

const INSIGHT_COLORS = ['#7c5cff', '#22d3ee', '#f472b6', '#facc15', '#34d399',
  '#fb923c', '#60a5fa', '#a3e635'];
const colorAt = (i) => INSIGHT_COLORS[i % INSIGHT_COLORS.length];

const VIEW_W = 620;
const VIEW_H = 400;
const PAD = 40;

// Project `centroids` + `points` into one shared 2-D frame and build the SVG
// node/line/legend model for a single taste map. Mirrors the original
// single-file app's buildClusterMap so the visualisation matches.
function buildClusterMap(centroids, points, mode) {
  const vectors = [];
  centroids.forEach((c) => vectors.push(Array.from(c)));
  points.forEach((p) => vectors.push(Array.from(p.emb)));
  const coords = pca2d(vectors);
  const nc = centroids.length;
  const centroidPts = coords.slice(0, nc);
  const pointPts = coords.slice(nc);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  coords.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  });
  const degenX = maxX - minX < 1e-9;
  const degenY = maxY - minY < 1e-9;
  const spanX = degenX ? 1 : maxX - minX;
  const spanY = degenY ? 1 : maxY - minY;
  const sx = (x) => (degenX ? VIEW_W / 2 : PAD + ((x - minX) / spanX) * (VIEW_W - 2 * PAD));
  const sy = (y) => (degenY ? VIEW_H / 2 : PAD + ((y - minY) / spanY) * (VIEW_H - 2 * PAD));

  const lines = [];
  const movieNodes = [];
  const centroidNodes = [];
  const stats = centroids.map(() => ({ liked: 0, recs: 0, members: 0, top: null, topSim: -Infinity }));

  points.forEach((p, i) => {
    const { index, sim } = nearestCentroid(p.emb, centroids);
    if (index < 0) return;
    const px = sx(pointPts[i][0]);
    const py = sy(pointPts[i][1]);
    const cx = sx(centroidPts[index][0]);
    const cy = sy(centroidPts[index][1]);
    const c = colorAt(index);
    const st = stats[index];
    if (p.kind === 'rec') {
      lines.push({ x1: px, y1: py, x2: cx, y2: cy, stroke: c, opacity: 0.12, dash: '2 3' });
      movieNodes.push({
        px, py, r: 5, fill: '#0b1020', stroke: c, sw: 2,
        title: p.title, info: `Cluster ${index + 1} · Match ${sim.toFixed(2)}`,
      });
      st.recs += 1;
    } else if (p.kind === 'member') {
      lines.push({ x1: px, y1: py, x2: cx, y2: cy, stroke: c, opacity: 0.18 });
      movieNodes.push({
        px, py, r: 4, fill: c, fillOpacity: 0.7,
        plain: `Cluster ${index + 1} · a room member's taste`,
      });
      st.members += 1;
    } else {
      lines.push({ x1: px, y1: py, x2: cx, y2: cy, stroke: c, opacity: 0.18 });
      movieNodes.push({
        px, py, r: 4.5, fill: c, fillOpacity: 0.85,
        title: p.title, info: `Cluster ${index + 1} · Liked (match ${sim.toFixed(2)})`,
      });
      st.liked += 1;
      if (sim > st.topSim) { st.topSim = sim; st.top = p.title; }
    }
  });

  centroids.forEach((c, i) => {
    const cx = sx(centroidPts[i][0]);
    const cy = sy(centroidPts[i][1]);
    const r = 9;
    centroidNodes.push({
      pts: `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`,
      fill: colorAt(i), cx, cy, r, label: i + 1,
    });
  });

  return { lines, movieNodes, centroidNodes, stats, mode };
}

// A single taste map: responsive SVG scatter + hover tooltip + cluster legend.
function ClusterMap({ map }) {
  const [hover, setHover] = useState(null);
  const {
    lines, movieNodes, centroidNodes, stats, mode,
  } = map;

  const legendKey = mode === 'group'
    ? [['fa-solid fa-diamond text-accent', 'Group cluster'],
      ['fa-solid fa-circle text-slate-400', "A member's taste"],
      ['fa-regular fa-circle text-slate-400', 'Recommendation']]
    : [['fa-solid fa-diamond text-accent', 'Taste cluster'],
      ['fa-solid fa-circle text-slate-400', 'Movie you liked'],
      ['fa-regular fa-circle text-slate-400', 'Recommendation']];

  const hoverMeta = hover ? movieMeta(hover.title) : null;

  return (
    <div className="space-y-2">
      <div className="relative insights-container">
        <svg
          className="insights-svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={mode === 'group'
            ? 'Two-dimensional map of the group taste clusters and members'
            : 'Two-dimensional map of your taste clusters and movies'}
          onMouseLeave={() => setHover(null)}
        >
          <g>
            {lines.map((l, i) => (
              <line
                key={`l-${i}`}
                x1={l.x1.toFixed(1)} y1={l.y1.toFixed(1)}
                x2={l.x2.toFixed(1)} y2={l.y2.toFixed(1)}
                stroke={l.stroke} strokeOpacity={l.opacity}
                strokeWidth={1} strokeDasharray={l.dash || undefined}
              />
            ))}
          </g>
          <g>
            {movieNodes.map((n, i) => (
              <circle
                key={`n-${i}`}
                className="insights-node"
                cx={n.px.toFixed(1)} cy={n.py.toFixed(1)} r={n.r}
                fill={n.fill} stroke={n.stroke || undefined} strokeWidth={n.sw || undefined}
                fillOpacity={n.fillOpacity != null ? n.fillOpacity : undefined}
                onMouseEnter={n.title ? () => setHover({
                  title: n.title, info: n.info, x: n.px, y: n.py,
                }) : undefined}
              >
                {n.plain ? <title>{n.plain}</title> : null}
              </circle>
            ))}
          </g>
          <g>
            {centroidNodes.map((c, i) => (
              <g key={`c-${i}`}>
                <polygon className="insights-node" points={c.pts} fill={c.fill} stroke="#0b1020" strokeWidth={1.5}>
                  <title>{`Cluster ${c.label}`}</title>
                </polygon>
                <text
                  x={c.cx.toFixed(1)} y={(c.cy - c.r - 5).toFixed(1)}
                  textAnchor="middle" fontSize="11" fontWeight="700" fill={c.fill}
                >
                  {c.label}
                </text>
              </g>
            ))}
          </g>
        </svg>

        {hover && (
          <div
            className="insights-tooltip absolute pointer-events-none bg-panel border border-line rounded-lg p-2 shadow-xl z-50 flex flex-col gap-1 items-center w-28 text-center"
            style={{
              left: `${(hover.x / VIEW_W) * 100}%`,
              top: `${(hover.y / VIEW_H) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 8px))',
            }}
          >
            <div className="shrink-0 mb-1">
              <Poster movie={hoverMeta || { title: hover.title }} className="w-16 h-24 rounded" />
            </div>
            <div className="text-[11px] font-semibold text-slate-100 leading-tight max-w-[100px] break-words">
              {hover.title}
            </div>
            {hover.info && <div className="text-[9px] text-slate-400 mt-0.5 leading-tight">{hover.info}</div>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 px-1">
        {legendKey.map(([icon, label]) => (
          <span key={label}><i className={`${icon} mr-1`} aria-hidden="true" />{label}</span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {stats.map((st, i) => (
          <div key={`st-${i}`} className="flex items-start gap-2 text-xs">
            <span className="insights-legend-dot mt-0.5" style={{ background: colorAt(i) }} />
            <div className="min-w-0">
              <div className="font-semibold text-slate-200">{`Cluster ${i + 1}`}</div>
              <div className="text-slate-400">
                {mode === 'group'
                  ? `${st.members} member taste${st.members === 1 ? '' : 's'} · ${st.recs} recommended`
                  : (
                    <>
                      {`${st.liked} liked · ${st.recs} recommended · `}
                      {st.top
                        ? <>e.g. <span className="text-slate-300">{st.top}</span></>
                        : 'no liked films yet'}
                    </>
                  )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ title, sub }) {
  return (
    <div className="space-y-0.5">
      <h4 className="font-display text-lg tracking-wide text-white">{title}</h4>
      <p className="text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

const EmptyMsg = ({ children }) => (
  <p className="text-sm text-slate-500 italic py-8 text-center">{children}</p>
);

export default function InsightsModal({ open, onClose }) {
  // Recompute the maps whenever the modal opens so they reflect current taste.
  const model = useMemo(() => {
    if (!open) return { status: 'closed' };
    if (!runtime.EMBEDDINGS_BUFFER) return { status: 'loading' };

    let profile;
    try { profile = buildTasteProfile(); } catch (e) { profile = null; }
    const centroids = (profile?.centroids || []).filter((c) => isVector(c));
    if (!centroids.length) return { status: 'empty' };

    // Liked films that shaped the personal clusters (de-duplicated by title).
    const likedSeen = new Set();
    const liked = [];
    (profile.positiveSamples || []).forEach((s) => {
      if (!isVector(s.emb)) return;
      const key = normTitle(s.title);
      if (likedSeen.has(key)) return;
      likedSeen.add(key);
      liked.push({ title: s.title, emb: s.emb, kind: 'liked' });
    });

    // Current on-screen recommendations (shared by both maps).
    const recs = [];
    const recSeen = new Set();
    const cache = getRecCache();
    ((cache && cache.list) || []).forEach((rec) => {
      const m = rec.movie;
      if (!m) return;
      const emb = movieEmbedding(m);
      if (!isVector(emb)) return;
      const key = normTitle(m.title);
      if (recSeen.has(key)) return;
      recSeen.add(key);
      recs.push({ title: m.title, emb, kind: 'rec' });
    });

    const personal = buildClusterMap(centroids, liked.concat(recs), 'personal');

    // Group map: secondary K-Means centroids + every member's taste + recs.
    const groupCentroids = (profile.groupCentroids || []).filter((c) => isVector(c));
    const memberPoints = [];
    centroids.forEach((c) => memberPoints.push({ emb: Array.from(c), kind: 'member' }));
    const pv = (runtime.state && runtime.state.peerVectors) || {};
    let peerCount = 0;
    Object.keys(pv).forEach((pid) => {
      if (pid === runtime.myId) return;
      const list = pv[pid];
      if (!Array.isArray(list)) return;
      let added = 0;
      list.forEach((v) => { if (isVector(v)) { memberPoints.push({ emb: Array.from(v), kind: 'member' }); added += 1; } });
      if (added) peerCount += 1;
    });
    const group = (peerCount > 0 && groupCentroids.length)
      ? buildClusterMap(groupCentroids, memberPoints.concat(recs), 'group')
      : null;

    return { status: 'ok', personal, group };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Taste insights" className="max-w-3xl">
      {model.status === 'loading' && (
        <EmptyMsg>Recommendation vectors are still loading — try again in a moment.</EmptyMsg>
      )}
      {model.status === 'empty' && (
        <EmptyMsg>Rate or train a few movies to build your taste clusters, then check back here.</EmptyMsg>
      )}
      {model.status === 'ok' && (
        <div className="space-y-4">
          <div className="space-y-3">
            <SectionTitle title="Your taste" sub="Your own liked films clustered into preference centroids." />
            <ClusterMap map={model.personal} />
          </div>
          <div className="space-y-3 pt-4 mt-2 border-t border-line">
            <SectionTitle title="Group taste" sub="A second round of K-Means over everyone’s centroids — the moods the room shares." />
            {model.group
              ? <ClusterMap map={model.group} />
              : <EmptyMsg>Group taste appears once other people join the room and share their tastes.</EmptyMsg>}
          </div>
        </div>
      )}
    </Modal>
  );
}
