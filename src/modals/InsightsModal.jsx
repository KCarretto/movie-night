import { useMemo } from 'react';
import Modal from '../ui/Modal.jsx';
import { runtime } from '../lib/runtime.js';
import { buildTasteProfile, getRecCache, getCandidates, roomSeenTitles } from '../lib/recengine.js';
import { normTitle } from '../lib/format.js';
import { loadNotInterested } from '../lib/storage.js';

function AlgorithmVisualization({ 
  catalogCount, 
  selectionBypassedCount, 
  guardrailsFilteredCount, 
  watchedCount,
  filterCount,
  scoredCount 
}) {
  return (
    <div className="bg-panel2 p-4 rounded-xl border border-line space-y-4">
      <div>
        <h4 className="font-semibold text-white text-base">Recommendation Funnel</h4>
        <p className="text-xs text-slate-400">How the recommendation engine filters and ranks the 18,725 catalog movies in real-time.</p>
      </div>

      {/* Funnel Progress Visual */}
      <div className="space-y-2.5 pt-1">
        {/* Step 1: Catalog */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300 font-semibold">1. Catalog Database</span>
            <span className="text-slate-400">{catalogCount.toLocaleString()} movies</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="bg-indigo-600 h-2 rounded-full" style={{ width: '100%' }} />
          </div>
        </div>

        {/* Step 2: Selection */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300 font-semibold">2. Heuristic Selection (Isolates Top 600)</span>
            <span className="text-slate-400">600 candidates</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${(600 / catalogCount) * 100}%` }} />
          </div>
          <div className="text-[10px] text-slate-500 italic">
            Bypassed {selectionBypassedCount.toLocaleString()} less relevant titles (not matching group's top genres, nearest semantic neighbors, or critical benchmarks).
          </div>
        </div>

        {/* Step 3: Filters & Exclusions */}
        <div className="bg-slate-900/40 p-3 rounded-lg border border-line/60 text-xs space-y-2">
          <div className="font-semibold text-slate-300">3. Candidate Exclusions (applied to the 600 pool):</div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="bg-slate-900/60 p-2 rounded-md border border-line/45 flex flex-col justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-500">Already Watched</span>
              <span className="text-sm font-semibold text-rose-400">-{watchedCount.toLocaleString()} movies</span>
              <span className="text-[9px] text-slate-500 leading-tight">Seen, rated, or nominated by room members.</span>
            </div>

            <div className="bg-slate-900/60 p-2 rounded-md border border-line/45 flex flex-col justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-500">Active Search Filters</span>
              <span className="text-sm font-semibold text-amber-500">-{filterCount.toLocaleString()} movies</span>
              <span className="text-[9px] text-slate-500 leading-tight">Do not match current genre or language selections.</span>
            </div>

            <div className="bg-slate-900/60 p-2 rounded-md border border-line/45 flex flex-col justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-500">Guardrail Dislikes</span>
              <span className="text-sm font-semibold text-rose-500">-{guardrailsFilteredCount.toLocaleString()} movies</span>
              <span className="text-[9px] text-slate-500 leading-tight">Blocked by explicit title, genre, or director dislikes.</span>
            </div>
          </div>
        </div>

        {/* Step 4: Scored Pool */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-300 font-semibold">4. Scoring Engine</span>
            <span className="text-emerald-400 font-bold">{scoredCount.toLocaleString()} movies ranked</span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${(scoredCount / 600) * 100}%` }} />
          </div>
          <div className="text-[10px] text-slate-500 italic">
            Remaining candidates are scored in sub-milliseconds against semantic similarity (65%), genre profile (20%), and Bayesian quality score (15%).
          </div>
        </div>
      </div>

      {/* Group Aggregation note */}
      <div className="bg-indigo-950/20 border border-indigo-900/35 p-2.5 rounded-lg text-[11px] text-indigo-300">
        <strong className="text-indigo-200">Group Aggregation:</strong> When matching in a room, individual scores are aggregated using a Least Misery model: 
        <span className="bg-slate-900/50 px-1.5 py-0.5 rounded font-mono ml-1 text-slate-300">0.70 * Mean + 0.30 * Min</span> to prioritize shared interests while blocking disliked picks.
      </div>
    </div>
  );
}

export default function InsightsModal({ open, onClose }) {
  const model = useMemo(() => {
    if (!open) return { status: 'closed' };
    if (!runtime.recommendationManifest) return { status: 'loading' };

    let profile;
    try {
      profile = buildTasteProfile();
    } catch (e) {
      profile = null;
    }
    
    if (!profile || (!profile.likedMovieIds.length && !profile.watchlistMovieIds.length)) {
      return { status: 'empty' };
    }

    const manifestMovies = runtime.recommendationManifest.movies || {};
    
    // Group liked and recommended movies by precomputed HDBSCAN cluster
    const clusterMap = {}; // clusterId -> { liked: [], recs: [], genres: {} }
    
    const getClusterObj = (cid) => {
      if (clusterMap[cid] === undefined) {
        clusterMap[cid] = { liked: [], recs: [], genres: {} };
      }
      return clusterMap[cid];
    };

    // Group liked movies
    profile.likedMovieIds.forEach(id => {
      const m = manifestMovies[id];
      if (m) {
        const cid = m.clusterId;
        const obj = getClusterObj(cid);
        obj.liked.push({ id, title: m.title });
        (m.genres || []).forEach(g => {
          obj.genres[g] = (obj.genres[g] || 0) + 1;
        });
      }
    });

    // Re-build activeMembers list
    const activeMembers = [profile];
    const peers = (runtime.state && runtime.state.peers) || [];
    const activePeers = peers.filter(p => p.connected !== false);
    const peerProfiles = runtime.peerProfiles || {};
    activePeers.forEach(p => {
      if (p.id !== runtime.myId && peerProfiles[p.id]) {
        activeMembers.push(peerProfiles[p.id]);
      }
    });

    // Get the candidates pool (pre-exclusions)
    const candidates = getCandidates(activeMembers); // length is 3000 - guardrailsFilteredCount

    // Replicate filters
    const activeGenres = runtime.activeSelectedGenres || [];
    const activeLangs = runtime.activeSelectedLanguages || [];
    const seenSet = roomSeenTitles();
    const nominatedSet = new Set((runtime.state?.movies || []).map((m) => normTitle(m.title)));
    const skipSet = new Set(loadNotInterested().map((x) => normTitle(x.title)));

    let watchedCount = 0;
    let filterCount = 0;

    candidates.forEach(m => {
      const movieObj = manifestMovies[m.id];
      if (!movieObj) return;

      // Genre/Lang filters
      if (activeGenres.length > 0) {
        const genreMatch = (movieObj.genres || []).some((g) => activeGenres.includes(g));
        if (!genreMatch) {
          filterCount++;
          return;
        }
      }
      if (activeLangs.length > 0) {
        if (!activeLangs.includes(movieObj.language)) {
          filterCount++;
          return;
        }
      }

      // Already Watched/Seen/Nominated
      const nt = normTitle(movieObj.title);
      if (seenSet.has(nt) || nominatedSet.has(nt) || skipSet.has(nt)) {
        watchedCount++;
        return;
      }
    });

    // Pipeline selection math
    const catalogCount = 18725;
    const maxSelectedCandidates = 600;
    const selectionBypassedCount = catalogCount - maxSelectedCandidates;
    const guardrailsFilteredCount = maxSelectedCandidates - candidates.length;
    
    const cache = getRecCache();
    const scoredCount = (cache && cache.totalAvailable) || 0;

    const recList = (cache && cache.list) || [];
    recList.forEach(rec => {
      const movieObj = rec.movie;
      if (!movieObj) return;
      const m = manifestMovies[String(movieObj.id)];
      if (m) {
        const cid = m.clusterId;
        const obj = getClusterObj(cid);
        obj.recs.push({ id: movieObj.id, title: m.title });
        (m.genres || []).forEach(g => {
          obj.genres[g] = (obj.genres[g] || 0) + 1;
        });
      }
    });

    // Structure cluster metadata
    const clusters = Object.entries(clusterMap).map(([cid, data]) => {
      const clusterId = Number(cid);
      const topGenres = Object.entries(data.genres)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(entry => entry[0]);
      
      const label = `Cluster ${clusterId + 1} (${topGenres.join(' & ') || 'Mixed'})`;
      
      return {
        clusterId,
        label,
        likedCount: data.liked.length,
        recsCount: data.recs.length,
        liked: data.liked.slice(0, 6),
        recs: data.recs.slice(0, 6),
      };
    }).sort((a, b) => (b.likedCount + b.recsCount) - (a.likedCount + a.recsCount));

    // Structure genre weights percentage
    const totalWeight = (profile.genreWeights || []).reduce((sum, gw) => sum + gw.weight, 0);
    const genres = (profile.genreWeights || []).map(gw => ({
      genre: gw.genre,
      weight: gw.weight,
      percentage: totalWeight > 0 ? Math.round((gw.weight / totalWeight) * 100) : 0
    })).sort((a, b) => b.weight - a.weight).slice(0, 6);

    return { 
      status: 'ok', 
      clusters, 
      genres, 
      scoredCount, 
      selectionBypassedCount, 
      guardrailsFilteredCount,
      watchedCount,
      filterCount
    };
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Taste Insights" className="max-w-3xl">
      {model.status === 'loading' && (
        <p className="text-sm text-slate-500 italic py-8 text-center">Loading recommendation insights — try again in a moment.</p>
      )}
      {model.status === 'empty' && (
        <p className="text-sm text-slate-500 italic py-8 text-center">Rate or add movies to your watchlist to build your taste clusters, then check back here.</p>
      )}
      {model.status === 'ok' && (
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
          {/* Recommendation Pipeline Visualization */}
          <AlgorithmVisualization
            catalogCount={18725}
            selectionBypassedCount={model.selectionBypassedCount}
            guardrailsFilteredCount={model.guardrailsFilteredCount}
            watchedCount={model.watchedCount}
            filterCount={model.filterCount}
            scoredCount={model.scoredCount}
          />

          {/* Taste Signature */}
          <div className="space-y-3 bg-panel2 p-4 rounded-xl border border-line">
            <div>
              <h4 className="font-semibold text-white text-base">Your Taste Signature</h4>
              <p className="text-xs text-slate-400">Top genres driving your recommendations based on liked and watchlist movies.</p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {model.genres.map(g => (
                <div key={g.genre} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-200">{g.genre}</span>
                    <span className="text-slate-400">{g.percentage}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-1.5 rounded-full" 
                      style={{ width: `${g.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Taste Clusters */}
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-white text-base">Your Taste Clusters</h4>
              <p className="text-xs text-slate-400">Your movies grouped by semantic density using offline HDBSCAN clustering.</p>
            </div>

            <div className="space-y-3">
              {model.clusters.map(c => (
                <div key={c.clusterId} className="bg-panel2/50 border border-line/75 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <span className="font-semibold text-sm text-slate-200">{c.label}</span>
                    <span className="text-xs text-slate-400">
                      {c.likedCount} liked · {c.recsCount} recommended
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Liked list */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Liked in this cluster</div>
                      {c.liked.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {c.liked.map(m => (
                            <span key={m.id} className="inline-block px-2 py-0.5 bg-slate-800 border border-slate-700/60 rounded-md text-[11px] text-slate-300">
                              {m.title}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 italic">None yet</div>
                      )}
                    </div>

                    {/* Recommendations list */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Picks for you</div>
                      {c.recs.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {c.recs.map(m => (
                            <span key={m.id} className="inline-block px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/25 rounded-md text-[11px] text-indigo-300">
                              {m.title}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 italic">None yet</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Guard Rails */}
          <div className="space-y-3 bg-panel2 p-4 rounded-xl border border-line">
            <div>
              <h4 className="font-semibold text-white text-base">Guard Rails</h4>
              <p className="text-xs text-slate-400">Movies filtered out of the candidate pool due to explicit room member dislikes.</p>
            </div>
            
            <div className="pt-1">
              {runtime.guardrailsFiltered && runtime.guardrailsFiltered.length > 0 ? (
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {runtime.guardrailsFiltered.map((m, idx) => (
                    <div key={idx} className="flex justify-between items-start gap-4 p-2 bg-slate-900/40 rounded-lg border border-line/40 text-xs">
                      <span className="font-semibold text-slate-200">{m.title}</span>
                      <span className="text-[10px] text-slate-400 italic shrink-0 text-right">{m.reason}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic">No movies were filtered out by guard rails.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
