// ======================================================================
//  PERSISTENT DATA CACHE (movies.pbf + embeddings_part*.bin)
// ======================================================================
// The catalogue (~12 MB) and the embedding parts (~50 MB each, ~200 MB total)
// are static binaries that only change when the twice-daily sync workflow
// regenerates them. Re-downloading them on every visit dominates page load.
//
// This module wraps fetch() with the Cache Storage API using a
// stale-while-revalidate strategy: a cached copy is served immediately (so
// repeat loads are near-instant and work offline), then the file is refreshed
// in the background so the *next* load picks up any catalogue update.
//
// When Cache Storage is unavailable (e.g. non-secure context or private mode)
// we transparently fall back to a plain revalidating network fetch.

const DATA_CACHE = 'plot-polls-data-v2';

// Cache Storage requires a secure context (https or localhost) and the global
// `caches` object. Probe defensively so a missing API never breaks loading.
function cacheSupported() {
  try {
    return typeof caches !== 'undefined'
      && typeof window !== 'undefined'
      && window.isSecureContext !== false;
  } catch (e) {
    return false;
  }
}

// A response holds real binary data only when it succeeded and is NOT the HTML
// app shell that a SPA host / custom 404 page returns (with a 200 status) for a
// missing path. Mirrors the guard used while probing for embedding parts, so we
// never persist an HTML shell as if it were a data file.
export function isBinaryResponse(res) {
  if (!res || !res.ok) return false;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  return !ct.includes('text/html');
}

// Fetch `url` through a persistent stale-while-revalidate cache.
// Returns a Response: the cached copy when present (refreshed in the
// background), otherwise the live network response. Only binary (non-HTML)
// responses are ever stored, and a cached entry whose URL no longer serves
// binary data (e.g. a removed embedding part) is evicted on revalidation.
export async function cachedFetch(url) {
  if (!cacheSupported()) {
    return fetch(url, { cache: 'no-cache' });
  }

  let cache;
  try {
    cache = await caches.open(DATA_CACHE);
  } catch (e) {
    return fetch(url, { cache: 'no-cache' });
  }

  const cached = await cache.match(url).catch(() => undefined);

  const revalidate = fetch(url, { cache: 'no-cache' }).then(async (res) => {
    try {
      if (isBinaryResponse(res)) {
        await cache.put(url, res.clone());
      } else if (cached) {
        // The URL stopped serving binary data — drop the stale entry so we
        // don't keep serving it on future loads.
        await cache.delete(url);
      }
    } catch (e) {
      /* cache writes are best-effort */
    }
    return res;
  });

  if (cached) {
    // Serve the cached copy now; let the refresh complete in the background.
    revalidate.catch(() => {});
    return cached;
  }
  return revalidate;
}
