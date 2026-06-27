// ======================================================================
//  ROOM CONTROLLER — PeerJS host/guest/mesh networking + action reducer
// ======================================================================
// This is the framework-agnostic networking layer ported from the original
// single-file app. It owns the PeerJS instance and the authoritative `state`
// (which lives on the shared runtime store), mutating runtime + calling emit()
// wherever the original called renderAll(). React subscribes via useStore.

import Peer from 'peerjs';
import {
  MAX_PEERS, MAX_NOMINATIONS, randomRoomId, normalizeRoomId,
  pickNickname, cleanName,
} from '../lib/constants.js';
import { runtime, emit } from '../lib/runtime.js';
import {
  loadSavedName, rememberHostRoom, recallHostRoom, mySeenShare, saveHostSession, loadHostSession
} from '../lib/storage.js';
import { loadMovieDb, movieMeta } from '../lib/catalog.js';
import { computeMyCentroids } from '../lib/recengine.js';
import { instantRunoff } from '../lib/irv.js';

let peer = null; // PeerJS instance
const connections = new Map(); // peerId -> DataConnection (open)
let booted = false;

// Keep-alive timers and state
const lastActive = new Map(); // peerId -> timestamp
let heartbeatInterval = null;
let hostCheckInterval = null;
let lastHostActive = 0;
let reconnectTimeout = null;
let isReconnecting = false;

window.addEventListener('beforeunload', () => {
  try {
    if (peer) peer.destroy();
  } catch (e) {}
});

function logNetwork(direction, peerId, msg) {
  const isHostMsg = !runtime.isHost && peerId === `room-${runtime.roomId}-host`;
  const hostIndicator = isHostMsg ? '👑 [HOST]' : '';
  console.log(
    `%c[${direction}]%c ${hostIndicator} to/from [${peerId}]:`,
    direction === 'SEND' ? 'color: #38bdf8; font-weight: bold;' : 'color: #34d399; font-weight: bold;',
    isHostMsg ? 'color: #fbbf24; font-weight: bold;' : 'color: #94a3b8;',
    msg
  );
}

// Convenience: the authoritative state object lives on the runtime store.
function S() { return runtime.state; }

// ---- network status ---------------------------------------------------------
function setStatus(kind, text) {
  // kind: 'ok' | 'warn' | 'err'  -> runtime.netStatus.level: ok | warn | err
  runtime.netStatus = { level: kind, text };
  emit();
}

function updateNetCount() {
  const state = S();
  const count = runtime.isHost ? state.peers.length : (state.peers.length || connections.size + 1);
  runtime.connCount = connections.size;
  if (connections.size === 0 && !runtime.isHost) {
    setStatus('warn', 'Connecting…');
  } else {
    setStatus('ok', `Connected · ${Math.min(count, MAX_PEERS)}/${MAX_PEERS}`);
  }
}

function handlePeerError(err) {
  console.warn('PeerJS error:', err && err.type, err);
  const t = err && err.type;
  if (t === 'peer-unavailable') {
    if (!runtime.isHost) {
      setStatus('warn', 'Host not found — retrying…');
      setTimeout(() => { if (connections.size === 0) connectToHost(); }, 1500);
    }
  } else if (t === 'unavailable-id') {
    if (runtime.isHost) {
      setStatus('warn', 'Reclaiming room…');
      setTimeout(() => { if (connections.size === 0) startHost(); }, 2000);
    } else {
      setStatus('err', 'Room id already hosting elsewhere');
    }
  } else if (t === 'network' || t === 'server-error' || t === 'socket-error') {
    setStatus('err', 'Signaling unavailable');
  } else {
    setStatus('err', 'Network error');
  }
}

// ---- taste sharing ----------------------------------------------------------
// My current K-Means taste centroids, recomputed fresh, then broadcast so peers
// can score candidates against the whole room's taste. Kept OUT of the render
// path to avoid re-entrant renders.
export function myTasteVector() {
  const c = computeMyCentroids();
  return (c && c.length) ? c : [];
}
export function shareVector() {
  dispatch({ type: 'setVector', vector: myTasteVector() });
}
export function shareSeen() {
  dispatch({ type: 'setSeen', seen: mySeenShare() });
  shareVector();
  emit();
}
// Re-share taste + re-render after any taste-shaping change (rating, watchlist,
// training). Recommendations re-rank on the next render via recSignature().
export function afterTasteChange() {
  shareVector();
  emit();
}

// ======================================================================
//  BOOTSTRAP — decide host vs guest from the URL
// ======================================================================
export function boot() {
  if (booted) return;
  booted = true;

  const params = new URLSearchParams(location.search);
  const urlRoom = params.get('room');
  const syncId = params.get('sync');
  const hostRoom = recallHostRoom();
  const session = loadHostSession();

  if (urlRoom && normalizeRoomId(urlRoom) === hostRoom) {
    runtime.isHost = true;
    runtime.roomId = hostRoom;
    startHost();
  } else if (!urlRoom && session && session.roomId === hostRoom) {
    runtime.isHost = true;
    runtime.roomId = session.roomId;
    const url = `${location.pathname}?room=${runtime.roomId}`;
    history.replaceState({ room: runtime.roomId }, '', url);
    startHost();
  } else if (urlRoom) {
    runtime.isHost = false;
    runtime.roomId = normalizeRoomId(urlRoom);
    startGuest();
  } else {
    // DO NOT automatically host a room!
    // Instead, leave runtime.roomId = null and let the Landing UI handle it.
    runtime.roomId = null;
    runtime.isHost = false;
  }

  emit();
  loadMovieDb({ onEmbeddingsReady: shareVector });

  return { syncId };
}

export function startHostingRoom(roomId) {
  runtime.isHost = true;
  runtime.roomId = roomId || randomRoomId();
  rememberHostRoom(runtime.roomId);
  const url = `${location.origin}${location.pathname}?room=${runtime.roomId}`;
  history.pushState({ room: runtime.roomId }, '', url);
  startHost();
  emit();
}

export function joinRoom(roomId) {
  const norm = normalizeRoomId(roomId);
  if (!norm) return;
  runtime.isHost = false;
  runtime.roomId = norm;
  const url = `${location.origin}${location.pathname}?room=${runtime.roomId}`;
  history.pushState({ room: runtime.roomId }, '', url);
  startGuest();
  emit();
}

// ======================================================================
//  HOST SETUP
// ======================================================================
function startHost() {
  setStatus('warn', 'Starting host…');
  stopHostHeartbeatCheck();
  stopGuestHeartbeat();
  stopGuestReconnection();
  try { if (peer) peer.destroy(); } catch (e) { /* ignore */ }
  peer = new Peer(`room-${runtime.roomId}-host`, { debug: 1 });

  peer.on('open', (id) => {
    runtime.myId = id;
    const initialName = loadSavedName() || pickNickname([]);
    runtime.myName = initialName;

    const session = loadHostSession();
    if (session && session.roomId === runtime.roomId) {
      // Rehydrate state
      Object.assign(S(), session.state);
      // Ensure the host's identity matches this session's new peer ID
      const oldHost = S().peers[0];
      if (oldHost) {
        if (id !== oldHost.id) {
          if (S().seen && S().seen[oldHost.id]) {
            S().seen[id] = S().seen[oldHost.id];
            delete S().seen[oldHost.id];
          }
          if (S().votes && S().votes[oldHost.id]) {
            S().votes[id] = S().votes[oldHost.id];
            delete S().votes[oldHost.id];
          }
          if (S().peerVectors && S().peerVectors[oldHost.id]) {
            S().peerVectors[id] = S().peerVectors[oldHost.id];
            delete S().peerVectors[oldHost.id];
          }
        }
        oldHost.id = id;
        oldHost.name = initialName;
      } else {
        S().peers = [{ id, name: initialName, connected: true }];
      }
    } else {
      S().peers = [{ id, name: initialName, connected: true }];
    }

    setStatus('ok', `Hosting · ${S().peers.filter(p => p.connected !== false).length}/${MAX_PEERS}`);
    // Register the host's own watched movies into the shared seen map.
    if (S().seen) S().seen[id] = mySeenShare();
    else S().seen = { [id]: mySeenShare() };
    emit();
    // Seed the host's own taste vector (may be empty until embeddings load).
    shareVector();
    startHostHeartbeatCheck();
    emit();
  });

  peer.on('connection', (conn) => setupConnection(conn));
  peer.on('error', (err) => handlePeerError(err));
  peer.on('disconnected', () => {
    console.warn('Host disconnected from signaling server. Retrying to reconnect...');
    try { peer.reconnect(); } catch (e) { /* ignore */ }
  });
}

// ======================================================================
//  GUEST SETUP
// ======================================================================
function startGuest() {
  setStatus('warn', 'Connecting…');
  runtime.myName = 'Connecting…';
  emit();

  stopHostHeartbeatCheck();
  stopGuestHeartbeat();
  stopGuestReconnection();

  let peerId = localStorage.getItem('movieNightGuestId');
  if (!peerId) {
    peerId = `peer-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('movieNightGuestId', peerId);
  }

  peer = new Peer(peerId, { debug: 1 });

  peer.on('open', (id) => {
    runtime.myId = id;
    connectToHost();
  });
  peer.on('connection', (conn) => setupConnection(conn));
  peer.on('error', (err) => handlePeerError(err));
  peer.on('disconnected', () => {
    console.warn('Guest disconnected from signaling server. Retrying to reconnect...');
    try { peer.reconnect(); } catch (e) { /* ignore */ }
  });
}

function connectToHost() {
  const hostId = `room-${runtime.roomId}-host`;
  const conn = peer.connect(hostId, { reliable: true, metadata: { role: 'guest' } });
  setupConnection(conn, () => {
    stopGuestReconnection();
    startGuestHeartbeat();
    safeSend(conn, { type: 'join', name: loadSavedName() });
    safeSend(conn, { type: 'action', action: { type: 'setSeen', seen: mySeenShare() } });
    safeSend(conn, { type: 'action', action: { type: 'setVector', vector: myTasteVector() } });
  });
}

function recreateGuestPeer(onOpen) {
  try { if (peer) peer.destroy(); } catch (e){}
  
  let peerId = localStorage.getItem('movieNightGuestId');
  if (!peerId) {
    peerId = `peer-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('movieNightGuestId', peerId);
  }
  
  peer = new Peer(peerId, { debug: 1 });
  peer.on('open', (id) => {
    runtime.myId = id;
    if (typeof onOpen === 'function') onOpen();
  });
  peer.on('connection', (conn) => setupConnection(conn));
  peer.on('error', (err) => handlePeerError(err));
  peer.on('disconnected', () => {
    try { peer.reconnect(); } catch (e) {}
  });
}

function startHostHeartbeatCheck() {
  stopHostHeartbeatCheck();
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    let stateChanged = false;
    S().peers.forEach((p) => {
      if (p.id === runtime.myId) return; // skip host
      const lastTime = lastActive.get(p.id) || 0;
      if (lastTime > 0 && now - lastTime > 30000) {
        if (p.connected !== false) {
          p.connected = false;
          stateChanged = true;
          console.log(`Peer ${p.name} (${p.id}) keep-alive timed out.`);
          broadcast({ type: 'peer-left', peerId: p.id, name: p.name });
          const conn = connections.get(p.id);
          if (conn) {
            try { conn.close(); } catch (e) {}
            connections.delete(p.id);
          }
        }
      }
    });
    if (stateChanged) {
      broadcastState();
      emit();
      updateNetCount();
    }
  }, 5000);
}

function stopHostHeartbeatCheck() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function startGuestHeartbeat() {
  stopGuestHeartbeat();
  lastHostActive = Date.now();
  heartbeatInterval = setInterval(() => {
    const hostConn = connections.get(`room-${runtime.roomId}-host`);
    if (hostConn && hostConn.open) {
      safeSend(hostConn, { type: 'ping' });
    }
  }, 5000);

  hostCheckInterval = setInterval(() => {
    if (Date.now() - lastHostActive > 30000) {
      console.warn('Host heartbeat timed out. Reconnecting...');
      triggerGuestReconnection();
    }
  }, 5000);
}

function stopGuestHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (hostCheckInterval) {
    clearInterval(hostCheckInterval);
    hostCheckInterval = null;
  }
}

function triggerGuestReconnection() {
  if (runtime.isHost) return;
  if (isReconnecting) return;
  isReconnecting = true;
  setStatus('warn', 'Connection lost — reconnecting…');
  stopGuestHeartbeat();
  
  connections.forEach((conn) => {
    try { conn.close(); } catch (e) {}
  });
  connections.clear();
  updateNetCount();
  
  let attempts = 0;
  const attempt = () => {
    if (!isReconnecting) return;
    attempts++;
    console.log(`Reconnection attempt #${attempts} to host...`);
    
    if (!peer || peer.destroyed || peer.disconnected) {
      recreateGuestPeer(() => {
        connectToHost();
      });
    } else {
      connectToHost();
    }
    
    reconnectTimeout = setTimeout(attempt, 2000);
  };
  
  attempt();
}

function stopGuestReconnection() {
  isReconnecting = false;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

// ======================================================================
//  CONNECTION PLUMBING (shared by host + guest, with dup guards)
// ======================================================================
function setupConnection(conn, onOpen) {
  conn.on('open', () => {
    if (connections.has(conn.peer) && connections.get(conn.peer) !== conn) {
      const oldConn = connections.get(conn.peer);
      console.log(`Replacing duplicate/reconnection from peer: ${conn.peer}`);
      try { oldConn.close(); } catch (e) { /* ignore */ }
    }
    connections.set(conn.peer, conn);
    if (runtime.isHost) {
      lastActive.set(conn.peer, Date.now());
      const existingPeer = S().peers.find(p => p.id === conn.peer);
      if (existingPeer && existingPeer.connected === false) {
        existingPeer.connected = true;
        broadcastState();
        emit();
      }
    } else {
      if (conn.peer === `room-${runtime.roomId}-host`) {
        lastHostActive = Date.now();
      }
    }
    updateNetCount();
    if (typeof onOpen === 'function') onOpen();
  });

  conn.on('data', (msg) => {
    logNetwork('RECV', conn.peer, msg);
    if (runtime.isHost) {
      lastActive.set(conn.peer, Date.now());
    } else {
      if (conn.peer === `room-${runtime.roomId}-host`) {
        lastHostActive = Date.now();
      }
    }
    handleMessage(conn, msg);
  });

  conn.on('close', () => {
    if (connections.get(conn.peer) === conn) connections.delete(conn.peer);
    if (runtime.isHost) {
      const p = S().peers.find((x) => x.id === conn.peer);
      if (p && p.connected !== false) {
        p.connected = false;
        broadcast({ type: 'peer-left', peerId: conn.peer, name: p.name });
        broadcastState();
        emit();
      }
    } else if (conn.peer === `room-${runtime.roomId}-host`) {
      triggerGuestReconnection();
    }
    updateNetCount();
  });

  conn.on('error', () => { /* surfaced via peer 'error' too */ });
}

function safeSend(conn, obj) {
  try {
    if (conn && conn.open) {
      logNetwork('SEND', conn.peer, obj);
      conn.send(obj);
    }
  } catch (e) { /* ignore */ }
}

function broadcast(obj, exceptId) {
  connections.forEach((conn, id) => { if (id !== exceptId) safeSend(conn, obj); });
}

// ======================================================================
//  MESSAGE ROUTING
// ======================================================================
function handleMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'join':
      if (!runtime.isHost) return;
      hostAddPeer(conn.peer, msg.name);
      break;
    case 'directory':
      if (runtime.isHost) return;
      meshConnect(msg.peers);
      break;
    case 'state':
      if (runtime.isHost) return;
      applyRemoteState(msg.state);
      break;
    case 'hello':
      break;
    case 'action':
      if (!runtime.isHost) return;
      applyAction(msg.action, conn.peer);
      break;
    case 'peer-left':
      console.log(`%c[INFO] Peer left: ${msg.name || msg.peerId}`, 'color: #f43f5e; font-weight: bold;');
      break;
    case 'ping':
      if (runtime.isHost) {
        lastActive.set(conn.peer, Date.now());
        const pObj = S().peers.find(p => p.id === conn.peer);
        if (pObj && pObj.connected === false) {
          pObj.connected = true;
          broadcastState();
          emit();
        }
        safeSend(conn, { type: 'pong' });
      }
      break;
    case 'pong':
      if (!runtime.isHost) {
        lastHostActive = Date.now();
      }
      break;
  }
}

// ======================================================================
//  HOST: roster management
// ======================================================================
function hostAddPeer(peerId, requestedName) {
  const state = S();
  const existingPeer = state.peers.find((p) => p.id === peerId);

  if (existingPeer) {
    existingPeer.connected = true;
    lastActive.set(peerId, Date.now());
    // Guest is already known (reconnected). Ensure they get the current state and directory.
    const conn = connections.get(peerId);
    if (conn) {
      safeSend(conn, { type: 'directory', peers: state.peers.map((p) => p.id) });
      safeSend(conn, { type: 'state', state });
    }
    broadcastState();
    emit();
    return;
  }

  if (state.peers.length >= MAX_PEERS) {
    const conn = connections.get(peerId);
    if (conn) safeSend(conn, { type: 'state', state: { ...state, full: true } });
    try { conn && conn.close(); } catch (e) { /* ignore */ }
    return;
  }

  const taken = state.peers.map((p) => p.name);
  const cleaned = cleanName(requestedName);
  const name = (cleaned && !taken.includes(cleaned)) ? cleaned : pickNickname(taken);
  state.peers.push({ id: peerId, name, connected: true });
  lastActive.set(peerId, Date.now());

  broadcastDirectory();
  broadcastState();
  emit();
  updateNetCount();
}

function removePeer(peerId) {
  const state = S();
  if (state.phase !== 'lobby') return; // Don't remove peers once voting starts so they can reconnect
  const before = state.peers.length;
  state.peers = state.peers.filter((p) => p.id !== peerId);
  delete state.votes[peerId];
  if (state.seen) delete state.seen[peerId];
  if (state.peerVectors) delete state.peerVectors[peerId];
  if (state.peers.length !== before) {
    broadcastDirectory();
    maybeAutoFinish();
    broadcastState();
    emit();
  }
}

function broadcastDirectory() {
  const ids = S().peers.map((p) => p.id);
  broadcast({ type: 'directory', peers: ids });
}

function broadcastState() {
  if (runtime.isHost) {
    saveHostSession(runtime.roomId, S());
  }
  broadcast({ type: 'state', state: S() });
}

// ======================================================================
//  GUEST: mesh building + state ingestion
// ======================================================================
function meshConnect(peerIds) {
  peerIds.forEach((id) => {
    if (id === runtime.myId) return;
    if (id === `room-${runtime.roomId}-host`) return;
    if (connections.has(id)) return;
    if (runtime.myId < id) {
      const conn = peer.connect(id, { reliable: true, metadata: { role: 'mesh' } });
      setupConnection(conn, () => safeSend(conn, { type: 'hello' }));
    }
  });
}

function applyRemoteState(remote) {
  if (!remote) return;
  if (remote.full) {
    setStatus('err', 'Room is full (6/6)');
    return;
  }
  runtime.state = remote;
  const me = remote.peers.find((p) => p.id === runtime.myId);
  runtime.myName = me ? me.name : 'Connecting…';
  setStatus('ok', `Connected · ${remote.peers.length}/${MAX_PEERS}`);
  emit();
}

// ======================================================================
//  ACTIONS — guests dispatch to host; host applies locally
// ======================================================================
export function dispatch(action) {
  if (runtime.isHost) {
    applyAction(action, runtime.myId);
  } else {
    const hostConn = connections.get(`room-${runtime.roomId}-host`);
    safeSend(hostConn, { type: 'action', action });
  }
}

function applyAction(action, fromId) {
  if (!runtime.isHost || !action) return;
  const state = S();

  switch (action.type) {
    case 'nominate': {
      if (state.phase !== 'lobby') return;
      const mine = state.movies.filter((m) => m.by === fromId).length;
      if (mine >= MAX_NOMINATIONS) return;
      const title = String(action.title || '').trim().slice(0, 80);
      if (!title) return;
      const resolveId = (t, id) => id || (movieMeta(t) || {}).id;
      const targetId = resolveId(title, action.tmdbId);
      const isDup = state.movies.some((m) => {
        const mId = resolveId(m.title, m.tmdbId);
        if (targetId && mId) return targetId === mId;
        return m.title.toLowerCase() === title.toLowerCase();
      });
      if (isDup) return;
      state.movies.push({ id: 'm_' + Math.random().toString(36).slice(2, 9), title, tmdbId: action.tmdbId, by: fromId });
      break;
    }
    case 'removeNomination': {
      if (state.phase !== 'lobby') return;
      const movie = state.movies.find((m) => m.id === action.movieId);
      if (!movie || movie.by !== fromId) return;
      state.movies = state.movies.filter((m) => m.id !== action.movieId);
      break;
    }
    case 'startVoting': {
      if (fromId !== runtime.myId) return;
      if (state.phase !== 'lobby') return;
      if (state.movies.length < 2) return;
      state.phase = 'voting';
      state.votes = {};
      break;
    }
    case 'cancelVoting': {
      if (fromId !== runtime.myId) return;
      if (state.phase !== 'voting') return;
      state.phase = 'lobby';
      state.votes = {};
      break;
    }
    case 'vote': {
      if (state.phase !== 'voting') return;
      const valid = Array.isArray(action.ranking) ? action.ranking
        .filter((id) => state.movies.some((m) => m.id === id)) : [];
      state.votes[fromId] = [...new Set(valid)];
      maybeAutoFinish();
      break;
    }
    case 'closeVoting': {
      if (fromId !== runtime.myId) return;
      if (state.phase !== 'voting') return;
      finishVoting();
      return;
    }
    case 'reset': {
      if (fromId !== runtime.myId) return;
      state.phase = 'lobby';
      state.movies = [];
      state.votes = {};
      state.results = null;
      break;
    }
    case 'setName': {
      const target = state.peers.find((p) => p.id === fromId);
      if (!target) return;
      const cleaned = cleanName(action.name);
      if (!cleaned) return;
      if (state.peers.some((p) => p.id !== fromId && p.name === cleaned)) return;
      target.name = cleaned;
      break;
    }
    case 'setSeen': {
      if (!state.peers.some((p) => p.id === fromId)) return;
      const list = Array.isArray(action.seen) ? action.seen : [];
      if (!state.seen) state.seen = {};
      state.seen[fromId] = list
        .filter((s) => s && typeof s.title === 'string')
        .slice(0, 500)
        .map((s) => ({ title: String(s.title).slice(0, 120), rating: Number(s.rating) || 0 }));
      break;
    }
    case 'setVector': {
      if (!state.peers.some((p) => p.id === fromId)) return;
      if (!state.peerVectors) state.peerVectors = {};
      let v = action.vector;
      if (Array.isArray(v) && v.length && typeof v[0] === 'number') v = [v];
      const isFloatVec = (vec) => (Array.isArray(vec) || ArrayBuffer.isView(vec)) && vec.length > 0 && vec.length <= 2048
          && Array.from(vec).every((n) => typeof n === 'number' && isFinite(n));
      if (Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every(isFloatVec)) {
        state.peerVectors[fromId] = v.map((vec) => Array.from(vec).map((n) => Number(n)));
      } else {
        delete state.peerVectors[fromId];
      }
      break;
    }
  }

  broadcastState();
  emit();
}

function maybeAutoFinish() {
  const state = S();
  if (state.phase !== 'voting') return;
  const activePeers = state.peers.filter(p => p.connected !== false);
  const voters = Object.keys(state.votes).filter(id => activePeers.some(p => p.id === id)).length;
  if (voters >= activePeers.length && activePeers.length > 0) finishVoting();
}

function finishVoting() {
  const state = S();
  state.results = instantRunoff(state.votes, state.movies);
  state.phase = 'results';
  broadcastState();
  emit();
}

// ---- convenience action wrappers used by the UI ----------------------------
export const actions = {
  nominate: (title, tmdbId) => dispatch({ type: 'nominate', title, tmdbId }),
  removeNomination: (movieId) => dispatch({ type: 'removeNomination', movieId }),
  startVoting: () => dispatch({ type: 'startVoting' }),
  vote: (ranking) => dispatch({ type: 'vote', ranking }),
  closeVoting: () => dispatch({ type: 'closeVoting' }),
  cancelVoting: () => dispatch({ type: 'cancelVoting' }),
  reset: () => dispatch({ type: 'reset' }),
  setName: (name) => dispatch({ type: 'setName', name }),
  startHostingRoom,
  joinRoom,
};

export function shareUrl() {
  return `${location.origin}${location.pathname}?room=${runtime.roomId}`;
}
