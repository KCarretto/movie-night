// ----------------------- Vector math (pure) ---------------------------
// Cosine similarity, light cosine K-Means clustering, and a top-2 PCA via power
// iteration. Ported verbatim from the original so recommendation behaviour is
// unchanged.

import { isVector } from './format.js';

// Cosine similarity between two equal-length numeric vectors, in [-1, 1].
export function cosineSimilarity(a, b) {
  if (!isVector(a) || !isVector(b) || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Partition weighted embedding samples into up to `k` cosine-distance K-Means
// clusters (Lloyd's algorithm, few iterations). Returns normalised centroids.
export function clusterCentroids(samples, k, iters) {
  const pts = samples
    .filter((s) => isVector(s.emb) && s.emb.length > 0)
    .map((s) => ({ emb: s.emb, weight: (s.weight > 0 ? s.weight : 1) }));
  if (!pts.length) return [];
  const dim = pts[0].emb.length;
  const norm = (v) => {
    let mag = 0;
    for (let i = 0; i < v.length; i++) mag += v[i] * v[i];
    mag = Math.sqrt(mag);
    if (!mag) return v.slice();
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / mag;
    return out;
  };
  if (pts.length <= k) return pts.map((p) => norm(Array.from(p.emb)));
  const centroids = [];
  for (let c = 0; c < k; c++) {
    const idx = Math.floor((c * pts.length) / k);
    centroids.push(norm(Array.from(pts[idx].emb)));
  }
  const assign = new Array(pts.length).fill(0);
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (let p = 0; p < pts.length; p++) {
      let best = 0, bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = cosineSimilarity(pts[p].emb, centroids[c]);
        if (sim > bestSim) { bestSim = sim; best = c; }
      }
      if (assign[p] !== best) { assign[p] = best; moved = true; }
    }
    const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
    const totalW = new Array(k).fill(0);
    for (let p = 0; p < pts.length; p++) {
      const c = assign[p], emb = pts[p].emb, wt = pts[p].weight;
      totalW[c] += wt;
      for (let i = 0; i < dim; i++) sums[c][i] += emb[i] * wt;
    }
    for (let c = 0; c < k; c++) {
      if (!totalW[c]) continue;
      for (let i = 0; i < dim; i++) sums[c][i] /= totalW[c];
      centroids[c] = norm(sums[c]);
    }
    if (!moved && it > 0) break;
  }
  const live = new Set(assign);
  return centroids.filter((_, c) => live.has(c));
}

// Index of the centroid most similar to `emb` (cosine), or -1 if none.
export function nearestCentroid(emb, centroids) {
  let best = -1, bestSim = -Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const s = cosineSimilarity(emb, centroids[c]);
    if (s > bestSim) { bestSim = s; best = c; }
  }
  return { index: best, sim: bestSim };
}

// Top-2 PCA of a list of equal-length vectors via power iteration on the
// (implicit) covariance matrix. Returns one [x, y] coordinate per input row.
export function pca2d(vectors) {
  const n = vectors.length;
  if (!n) return [];
  const dim = vectors[0].length;
  const mean = new Float64Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i];
  for (let i = 0; i < dim; i++) mean[i] /= n;
  const X = vectors.map((v) => {
    const r = new Float64Array(dim);
    for (let i = 0; i < dim; i++) r[i] = v[i] - mean[i];
    return r;
  });
  const normalize = (v) => {
    let mag = 0;
    for (let i = 0; i < v.length; i++) mag += v[i] * v[i];
    mag = Math.sqrt(mag);
    if (!mag) return false;
    for (let i = 0; i < v.length; i++) v[i] /= mag;
    return true;
  };
  function component(prev) {
    const v = new Float64Array(dim);
    for (let i = 0; i < dim; i++) v[i] = Math.sin((i + 1) * 12.9898 + prev.length);
    const orth = (vec) => {
      for (const e of prev) {
        let d = 0;
        for (let i = 0; i < dim; i++) d += vec[i] * e[i];
        for (let i = 0; i < dim; i++) vec[i] -= d * e[i];
      }
    };
    orth(v);
    if (!normalize(v)) return new Float64Array(dim);
    for (let iter = 0; iter < 64; iter++) {
      const w = new Float64Array(dim);
      for (let r = 0; r < X.length; r++) {
        const row = X[r];
        let proj = 0;
        for (let i = 0; i < dim; i++) proj += row[i] * v[i];
        for (let i = 0; i < dim; i++) w[i] += row[i] * proj;
      }
      orth(w);
      if (!normalize(w)) break;
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += w[i] * v[i];
      for (let i = 0; i < dim; i++) v[i] = w[i];
      if (Math.abs(dot) > 0.999999) break;
    }
    return v;
  }
  const pc1 = component([]);
  const pc2 = component([pc1]);
  return X.map((row) => {
    let x = 0, y = 0;
    for (let i = 0; i < dim; i++) { x += row[i] * pc1[i]; y += row[i] * pc2[i]; }
    return [x, y];
  });
}
