// ======================================================================
//  DEVICE SYNC — dedicated PeerJS peer for cross-device data transfer.
//
//  Kept entirely separate from the voting-room PeerJS instance so sync
//  operations never interfere with an ongoing room session.
// ======================================================================

import Peer from 'peerjs';

let _syncPeer = null;

export function destroySyncPeer() {
  try { if (_syncPeer) _syncPeer.destroy(); } catch (e) {}
  _syncPeer = null;
}

/**
 * Start sync share mode: spin up a dedicated PeerJS peer and advertise this
 * device's data. Calls onReady(url) once the peer is open and a QR-friendly
 * URL is available; onStatus(text) for status updates.
 *
 * The peer waits for an incoming connection. When the peer sends a
 * 'sync-request' message, buildPayload() is called and the result is
 * returned as a 'sync-data' message.
 */
export function startSyncShare({ buildPayload, onReady, onStatus, onImport }) {
  destroySyncPeer();
  const id = `sync-${Math.random().toString(36).slice(2, 10)}`;
  _syncPeer = new Peer(id, { debug: 1 });

  _syncPeer.on('open', (openId) => {
    const url = `${location.origin}${location.pathname}?sync=${encodeURIComponent(openId)}`;
    onReady?.(url);
    onStatus?.('Waiting for the other device\u2026');
  });

  _syncPeer.on('connection', (conn) => {
    conn.on('open', () => onStatus?.('Exchanging data\u2026'));
    conn.on('data', (msg) => {
      if (msg && msg.type === 'sync-request') {
        try { conn.send({ type: 'sync-data', payload: buildPayload() }); } catch (e) {}
        if (msg.payload) {
          onImport?.(msg.payload);
        }
        onStatus?.('Data exchanged \u2713');
      }
    });
    conn.on('error', () => {});
  });

  _syncPeer.on('error', () => onStatus?.('Sync connection error.'));
}

/**
 * Connect to a sync host peer and receive its exported data.
 * Calls onStatus(text) for progress updates, onData(payload) on success,
 * onError(message) on failure. Returns a cleanup function.
 */
export function startSyncReceive({ hostId, buildPayload, onStatus, onData, onError }) {
  destroySyncPeer();
  let done = false;
  const fail = (m) => { if (!done) { done = true; onError?.(m); } };

  _syncPeer = new Peer(`syncrx-${Math.random().toString(36).slice(2, 10)}`, { debug: 1 });

  _syncPeer.on('open', () => {
    const conn = _syncPeer.connect(hostId, { reliable: true });
    conn.on('open', () => {
      onStatus?.('Exchanging data\u2026');
      try { conn.send({ type: 'sync-request', payload: buildPayload ? buildPayload() : undefined }); } catch (e) {}
    });
    conn.on('data', (msg) => {
      if (msg && msg.type === 'sync-data') {
        done = true;
        try { conn.close(); } catch (e) {}
        destroySyncPeer();
        onData?.(msg.payload);
      }
    });
    conn.on('error', () => fail('Connection error.'));
  });

  _syncPeer.on('error', () => fail('Could not reach the other device.'));

  const t = setTimeout(() => fail('Timed out waiting for the other device.'), 20000);

  return () => {
    clearTimeout(t);
    destroySyncPeer();
  };
}

/**
 * Extract a sync peer ID from QR-decoded text.
 * Accepts either a full app URL (e.g. https://…?sync=sync-abc123) or a
 * bare peer ID (sync-abc123).
 */
export function extractSyncId(text) {
  if (!text) return '';
  try {
    const u = new URL(text);
    const id = u.searchParams.get('sync');
    if (id) return id;
  } catch (e) { /* not a URL */ }
  return /^sync-[a-z0-9]+$/i.test(text.trim()) ? text.trim() : '';
}
