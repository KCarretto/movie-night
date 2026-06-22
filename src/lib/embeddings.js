// ======================================================================
//  EMBEDDINGS (data/embeddings_part*.bin, lazy-loaded after the catalogue)
// ======================================================================
// Failure is non-fatal: the recommendation engine simply falls back to neutral
// similarity scores when the embedding buffer is missing.

import { EMBED_DIM } from './constants.js';
import { isVector } from './format.js';
import { runtime, emit } from './runtime.js';

// Resolve a movie's static embedding vector as a zero-copy Float32Array view
// straight out of the shared embeddings buffer, or null if the buffer hasn't
// loaded yet or this movie has no vector pointer.
export function movieEmbedding(m) {
  const buf = runtime.EMBEDDINGS_BUFFER;
  if (!buf || !m || m.vIdx == null) return null;
  const byteOffset = m.vIdx * EMBED_DIM * 4;
  if (byteOffset + EMBED_DIM * 4 > buf.byteLength) return null;
  return new Float32Array(buf, byteOffset, EMBED_DIM);
}

// Fetch the chunked parts (data/embeddings_part*.bin) — falling back to a single
// data/embeddings.bin — and stash the raw bytes in the shared ArrayBuffer.
// `onReady` lets the controller re-share the local taste vector afterwards.
export async function loadEmbeddings({ onReady } = {}) {
  runtime.embeddingsStatus = 'loading';
  runtime.embeddingsError = '';
  emit();
  try {
    let buf;
    // 1. Try to load chunked embeddings starting from part 0.
    let partIdx = 0;
    const chunks = [];
    let res = await fetch(`data/embeddings_part${partIdx}.bin`, { cache: 'no-cache' });
    if (res.ok) {
      while (res.ok) {
        const chunkBuf = await res.arrayBuffer();
        chunks.push(new Uint8Array(chunkBuf));
        partIdx++;
        res = await fetch(`data/embeddings_part${partIdx}.bin`, { cache: 'no-cache' });
      }
      const totalLen = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      buf = combined.buffer;
    } else {
      // 2. Fall back to the single data/embeddings.bin file.
      const resSingle = await fetch('data/embeddings.bin', { cache: 'no-cache' });
      if (!resSingle.ok) throw new Error('HTTP ' + resSingle.status);
      buf = await resSingle.arrayBuffer();
    }

    if (!buf.byteLength || (buf.byteLength % (EMBED_DIM * 4)) !== 0) {
      throw new Error('invalid embeddings size');
    }
    runtime.EMBEDDINGS_BUFFER = buf;
    runtime.embeddingsStatus = 'ready';
  } catch (e) {
    runtime.EMBEDDINGS_BUFFER = null;
    runtime.embeddingsStatus = 'error';
    runtime.embeddingsError = (e && e.message) ? e.message : 'unknown error';
    console.warn('Could not load embeddings:', e);
    emit();
    return;
  }
  // Our own taste vector now resolves — let the controller recompute/re-share.
  if (typeof onReady === 'function') {
    try { onReady(); } catch (e) { /* ignore */ }
  }
  emit();
}

export { isVector };
