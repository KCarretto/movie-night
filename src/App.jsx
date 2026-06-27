import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import RoomBar from './components/RoomBar.jsx';
import Lobby from './components/Lobby.jsx';
import Recommendations from './components/Recommendations.jsx';
import Nominate from './components/Nominate.jsx';
import Vote from './components/Vote.jsx';
import RecentlyNominated from './components/RecentlyNominated.jsx';
import Results from './components/Results.jsx';
import History from './components/History.jsx';
import StartVoteModal from './modals/StartVoteModal.jsx';
import ImportConfirmModal from './modals/ImportConfirmModal.jsx';
import SyncModal from './modals/SyncModal.jsx';
import RecDetailModal from './modals/RecDetailModal.jsx';
import InsightsModal from './modals/InsightsModal.jsx';
import RateModal from './modals/RateModal.jsx';
import TrainModal from './modals/TrainModal.jsx';
import Card from './ui/Card.jsx';
import { movieMeta } from './lib/catalog.js';
import {
  loadHistory, saveHistory,
  loadWatched, saveWatched,
  loadWatchlist, saveWatchlist,
  loadInterested, saveInterested,
  loadNotInterested, saveNotInterested,
  loadNotSure, saveNotSure,
  loadSavedName, saveName,
  upsertWatched,
} from './lib/storage.js';
import { runtime, emit } from './lib/runtime.js';
import { markRankingStale, replaceRecommendation } from './lib/recengine.js';
import { actions, afterTasteChange, boot, shareSeen } from './state/controller.js';
import { useStore } from './state/useStore.js';
import { startSyncReceive } from './lib/syncpeer.js';

function unionByTitle(listA = [], listB = []) {
  const map = new Map();
  for (const row of [...listA, ...listB]) {
    const title = String(row?.title || '').trim();
    if (!title) continue;
    const key = title.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row, title });
    } else {
      const merged = { ...existing, ...row };
      if (existing.rating !== undefined && row.rating !== undefined) {
        merged.rating = Math.max(existing.rating, row.rating);
      }
      if (existing.interest !== undefined && row.interest !== undefined) {
        merged.interest = Math.max(existing.interest, row.interest);
      }
      // retain earliest addedAt/watchedAt if possible
      if (existing.watchedAt && row.watchedAt) merged.watchedAt = Math.min(existing.watchedAt, row.watchedAt);
      if (existing.addedAt && row.addedAt) merged.addedAt = Math.min(existing.addedAt, row.addedAt);
      if (existing.at && row.at) merged.at = Math.min(existing.at, row.at);
      map.set(key, merged);
    }
  }
  return Array.from(map.values());
}

function parseCsv(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function updateBackground(state) {
  const el = document.getElementById('bgArt');
  if (!el) return;
  const movies = state?.movies || [];
  const phase = state?.phase;
  const results = state?.results;
  const winnerMovie = results?.winnerId ? movies.find((m) => m.id === results.winnerId) : null;
  const winnerMeta = winnerMovie ? movieMeta(winnerMovie.title, winnerMovie.tmdbId) : null;

  if (phase === 'results' && winnerMeta?.art) {
    el.classList.add('winner');
    el.style.backgroundImage = `linear-gradient(180deg, rgba(11,13,18,.28), rgba(11,13,18,.72)), url('${winnerMeta.art}')`;
    el.classList.add('show');
    return;
  }

  const arts = movies
    .map((m) => movieMeta(m.title, m.tmdbId)?.art)
    .filter(Boolean)
    .slice(0, 6);
  if (!arts.length) {
    el.classList.remove('show', 'winner');
    el.style.backgroundImage = 'none';
    return;
  }

  el.classList.remove('winner');
  const layers = arts
    .map((u, i) => `linear-gradient(180deg, rgba(11,13,18,.52), rgba(11,13,18,.75)), url('${u}') ${(i * 17) % 100}% 0 / ${Math.max(16, 26 - i * 2)}% auto repeat-y`)
    .join(', ');
  el.style.backgroundImage = layers;
  el.classList.add('show');
}

export default function App() {
  const rt = useStore();
  const [showHistory, setShowHistory] = useState(false);
  const [startVoteOpen, setStartVoteOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [trainOpen, setTrainOpen] = useState(false);
  const [recDetail, setRecDetail] = useState(null);
  const [rateState, setRateState] = useState({ open: false, title: '', initial: 0 });
  const [pendingImport, setPendingImport] = useState(null);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const importRef = useRef(null);
  const letterboxdRef = useRef(null);
  const [savedSig, setSavedSig] = useState('');

  useEffect(() => {
    const out = boot();
    // If the page was opened via a sync link (?sync=<peerId>), auto-receive
    // the other device's data and present the import confirm dialog.
    if (out?.syncId) {
      startSyncReceive({
        hostId: out.syncId,
        onData: (payload) => {
          if (payload && typeof payload === 'object') {
            setPendingImport(payload);
            setImportConfirmOpen(true);
          }
        },
        onError: () => { /* silently ignore — user can retry via settings */ },
      });
    }
  }, []);

  useEffect(() => {
    updateBackground(rt.state);
  }, [rt.state?.phase, rt.state?.movies, rt.state?.results]);

  useEffect(() => {
    if (rt.state?.phase !== 'results' || !rt.state?.results?.winnerId) return;
    const sig = `${rt.roomId}|${rt.state.results.winnerId}|${rt.state.results.totalBallots}|${rt.state.movies.length}`;
    if (sig === savedSig) return;
    const list = loadHistory();
    list.push({
      at: Date.now(),
      roomId: rt.roomId,
      winnerId: rt.state.results.winnerId,
      winnerTitle: rt.state.results.winnerTitle,
      rounds: rt.state.results.rounds,
      totalBallots: rt.state.results.totalBallots,
      movies: rt.state.movies,
      peers: (rt.state.peers || []).map((p) => ({ id: p.id, name: p.name })),
      votes: rt.state.votes || {},
    });
    saveHistory(list.slice(-200));
    setSavedSig(sig);
  }, [rt.state?.phase, rt.state?.results, rt.state?.movies, rt.roomId, savedSig]);

  const roomPhase = rt.state?.phase || 'lobby';

  const handleRateSave = (rating) => {
    upsertWatched(rateState.title, rating);
    replaceRecommendation(rateState.title);
    markRankingStale();
    shareSeen();
    afterTasteChange();
    setRateState({ open: false, title: '', initial: 0 });
  };

  const openRate = (title) => {
    const w = loadWatched().find((x) => x.title.toLowerCase() === String(title).toLowerCase());
    setRateState({ open: true, title, initial: w?.rating || 0 });
  };

  const exportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      name: rt.myName || '',
      history: loadHistory(),
      watched: loadWatched(),
      watchlist: loadWatchlist(),
      interested: loadInterested(),
      notInterested: loadNotInterested(),
      notSure: loadNotSure(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plot-polls-export-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const mergeImportData = (d) => {
    saveHistory([...(loadHistory() || []), ...(Array.isArray(d.history) ? d.history : [])].slice(-300));
    saveWatched(unionByTitle(loadWatched() || [], Array.isArray(d.watched) ? d.watched : []));
    saveWatchlist(unionByTitle(loadWatchlist() || [], Array.isArray(d.watchlist) ? d.watchlist : []));
    saveInterested(unionByTitle(loadInterested() || [], Array.isArray(d.interested) ? d.interested : []));
    saveNotInterested(unionByTitle(loadNotInterested() || [], Array.isArray(d.notInterested) ? d.notInterested : []));
    saveNotSure(unionByTitle(loadNotSure() || [], Array.isArray(d.notSure) ? d.notSure : []));
    if (d.name) saveName(String(d.name).slice(0, 24));
    markRankingStale();
    shareSeen();
    afterTasteChange();
    emit();
  };

  const onImportFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const json = JSON.parse(text);
    setPendingImport(json);
    setImportConfirmOpen(true);
  };

  const onImportLetterboxd = async (file) => {
    if (!file) return;
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(Boolean);
    if (rows.length < 2) return;
    const header = parseCsv(rows[0]);
    const titleIdx = header.findIndex((h) => /name|title/i.test(h));
    const ratingIdx = header.findIndex((h) => /rating/i.test(h));
    const dateIdx = header.findIndex((h) => /watched|date/i.test(h));
    const watched = loadWatched();
    for (let i = 1; i < rows.length; i++) {
      const cols = parseCsv(rows[i]);
      const title = cols[titleIdx];
      if (!title) continue;
      const ratingRaw = Number(cols[ratingIdx]);
      const rating = Number.isFinite(ratingRaw) ? Math.max(0, Math.min(5, ratingRaw / 2)) : 0;
      const watchedAt = dateIdx >= 0 && cols[dateIdx] ? Date.parse(cols[dateIdx]) : Date.now();
      const existing = watched.find((w) => w.title.toLowerCase() === title.toLowerCase());
      if (existing) {
        existing.rating = rating || existing.rating || 0;
        existing.watchedAt = Number.isFinite(watchedAt) ? watchedAt : existing.watchedAt;
      } else {
        watched.push({ title, rating, watchedAt: Number.isFinite(watchedAt) ? watchedAt : Date.now() });
      }
    }
    saveWatched(watched);
    markRankingStale();
    shareSeen();
    afterTasteChange();
    emit();
  };

  const resetPrefs = () => {
    saveWatchlist([]);
    saveInterested([]);
    saveNotInterested([]);
    saveNotSure([]);
    runtime.activeSelectedGenres = [];
    runtime.activeSelectedLanguages = [];
    markRankingStale();
    afterTasteChange();
    emit();
  };

  const deleteAll = () => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('movieNight'));
    keys.forEach((k) => localStorage.removeItem(k));
    const skeys = Object.keys(sessionStorage).filter((k) => k.startsWith('movieNight'));
    skeys.forEach((k) => sessionStorage.removeItem(k));
    runtime.activeSelectedGenres = [];
    runtime.activeSelectedLanguages = [];
    markRankingStale();
    shareSeen();
    afterTasteChange();
    emit();
  };

  // Stable payload builder for the sync share flow (reads localStorage at call
  // time so the share effect doesn't need to re-fire when myName changes).
  const buildSyncPayload = useCallback(() => ({
    exportedAt: new Date().toISOString(),
    name: loadSavedName() || rt.myName || '',
    history: loadHistory(),
    watched: loadWatched(),
    watchlist: loadWatchlist(),
    interested: loadInterested(),
    notInterested: loadNotInterested(),
    notSure: loadNotSure(),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by SyncModal after a successful camera-based receive.
  const onSyncImport = useCallback((payload) => {
    if (payload && typeof payload === 'object') {
      setPendingImport(payload);
      setImportConfirmOpen(true);
    }
  }, []);

  const onSettingsAction = (action) => {
    if (action === 'changeName') {
      const next = window.prompt('Set display name', rt.myName || '');
      if (next && next.trim()) {
        actions.setName(next.trim());
        saveName(next.trim());
      }
      return;
    }
    if (action === 'export') return exportData();
    if (action === 'import') return importRef.current?.click();
    if (action === 'importLetterboxd') return letterboxdRef.current?.click();
    if (action === 'sync') return setSyncModalOpen(true);
    if (action === 'reset') return resetPrefs();
    if (action === 'deleteAll') return deleteAll();
  };

  const loadingText = useMemo(() => {
    if (rt.movieDbStatus === 'loading') return 'Loading movie catalogue…';
    if (rt.movieDbStatus === 'error') return `Movie catalogue failed: ${rt.movieDbError || 'Unknown error'}`;
    return null;
  }, [rt.movieDbStatus, rt.movieDbError]);

  return (
    <div className="min-h-full">
      <Header showHistory={showHistory} onToggleHistory={setShowHistory} onSettingsAction={onSettingsAction} />

      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-5 space-y-4">
        {!showHistory && roomPhase === 'lobby' && <RoomBar />}

        {loadingText && (
          <Card>
            <div className="text-sm text-slate-300 inline-flex items-center gap-2">
              <span className="spinner" />
              {loadingText}
            </div>
          </Card>
        )}

        {showHistory ? (
          <History />
        ) : (
          <>
            {roomPhase === 'lobby' && (
              <>
                <div className="space-y-4">
                  <Lobby />
                </div>

                <div className="grid gap-4 mt-4 min-w-0">
                  <div className="space-y-4 flex flex-col min-w-0">
                    <Recommendations
                      onOpenRec={(rec) => setRecDetail(rec)}
                      onOpenInsights={() => setInsightsOpen(true)}
                      onOpenTrain={() => setTrainOpen(true)}
                      onOpenRate={openRate}
                    />
                  </div>
                  <div className="space-y-4 flex flex-col min-w-0">
                    <Nominate onOpenStartVote={() => setStartVoteOpen(true)} />
                    <RecentlyNominated onOpenInfo={(rec) => setRecDetail({ movie: rec })} />
                  </div>
                </div>
              </>
            )}

            {roomPhase === 'voting' && (
              <div className="grid gap-4 min-w-0">
                <Vote onOpenInfo={(rec) => setRecDetail({ movie: rec })} />
              </div>
            )}

            {roomPhase === 'results' && (
              <div className="grid gap-4 min-w-0">
                <Results onRateWinner={openRate} />
              </div>
            )}
          </>
        )}
      </main>

      <footer className="max-w-6xl mx-auto px-3 sm:px-4 pb-6 text-center text-xs text-slate-400">
        <div>Serverless P2P over WebRTC · No data leaves your devices except signaling.</div>
        <div className="mt-1"><b>Version 37{typeof __COMMIT_HASH__ !== 'undefined' && __COMMIT_HASH__ ? ` - ${__COMMIT_HASH__}` : ''}</b></div>
      </footer>

      <input
        ref={importRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => onImportFile(e.target.files?.[0]).catch(() => {})}
      />
      <input
        ref={letterboxdRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => onImportLetterboxd(e.target.files?.[0]).catch(() => {})}
      />

      <StartVoteModal
        open={startVoteOpen}
        movieCount={rt.state?.movies?.length || 0}
        onClose={() => setStartVoteOpen(false)}
        onConfirm={() => {
          actions.startVoting();
          setStartVoteOpen(false);
        }}
      />

      <ImportConfirmModal
        open={importConfirmOpen}
        summary={{
          history: pendingImport?.history?.length || 0,
          watched: pendingImport?.watched?.length || 0,
          watchlist: pendingImport?.watchlist?.length || 0,
          interested: pendingImport?.interested?.length || 0,
        }}
        onClose={() => { setImportConfirmOpen(false); setPendingImport(null); }}
        onConfirm={() => {
          if (pendingImport) mergeImportData(pendingImport);
          setImportConfirmOpen(false);
          setPendingImport(null);
        }}
      />

      <SyncModal open={syncModalOpen} onClose={() => setSyncModalOpen(false)} buildPayload={buildSyncPayload} onImport={onSyncImport} />
      <RecDetailModal open={!!recDetail} rec={recDetail} onClose={() => setRecDetail(null)} onRate={openRate} />
      <InsightsModal open={insightsOpen} onClose={() => setInsightsOpen(false)} />
      <TrainModal open={trainOpen} onClose={() => setTrainOpen(false)} onRate={openRate} />
      <RateModal
        open={rateState.open}
        title={rateState.title}
        initial={rateState.initial}
        onClose={() => setRateState({ open: false, title: '', initial: 0 })}
        onSave={handleRateSave}
      />
    </div>
  );
}
