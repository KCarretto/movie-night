import React, { useEffect, useMemo, useState } from 'react';
import { movieMeta } from '../lib/catalog.js';
import GenreTags from '../ui/GenreTags.jsx';
import LanguageBadge from '../ui/LanguageBadge.jsx';
import Poster from '../ui/Poster.jsx';
import { actions, afterTasteChange } from '../state/controller.js';
import { useStore } from '../state/useStore.js';
import { saveMyVoteOrder, loadMyVoteOrder, inWatchlist, addToWatchlist, removeFromWatchlist } from '../lib/storage.js';
import { DndContext, DragOverlay, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableItemContent({ movie, meta, index, onOpenInfo }) {
  const inWl = inWatchlist(movie.title);

  return (
    <div className="flex items-start gap-2">
      <div className="text-xs text-slate-400 mt-1">#{index + 1}</div>
      <Poster movie={meta || movie} className="w-10 h-14 rounded flex-none" />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-100">{movie.title}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
          {meta && <GenreTags movie={meta} />}
          {meta && <LanguageBadge movie={meta} />}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-none self-start">
        <button
          type="button"
          className={`p-2 rounded-lg transition-colors ${
            inWl
              ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          title={inWl ? 'Remove from Watchlist' : 'Add to Watchlist'}
          aria-label={inWl ? 'Remove from Watchlist' : 'Add to Watchlist'}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (inWl) {
              removeFromWatchlist(movie.title);
            } else {
              addToWatchlist(movie.title);
            }
            afterTasteChange();
          }}
        >
          <i className={`${inWl ? 'fa-solid' : 'fa-regular'} fa-bookmark`} />
        </button>
        {meta && (
          <button
            type="button"
            className="text-slate-400 hover:text-white p-2"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenInfo(meta);
            }}
          >
            <i className="fa-solid fa-circle-info" />
          </button>
        )}
      </div>
    </div>
  );
}

function SortableItem({ id, movie, meta, index, onOpenInfo }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="rank-row rounded-lg border border-line bg-panel2 p-2.5 flex items-center cursor-grab active:cursor-grabbing hover:border-slate-500 transition-colors"
      style={style}
    >
      <div className="drag-handle text-slate-500 mr-2 p-1">
        <i className="fa-solid fa-grip-vertical" />
      </div>
      <div className="flex-1 min-w-0">
        <SortableItemContent movie={movie} meta={meta} index={index} onOpenInfo={onOpenInfo} />
      </div>
    </div>
  );
}

export default function Vote({ onOpenInfo }) {
  const rt = useStore();
  const movies = rt.state?.movies || [];
  const myVote = rt.state?.votes?.[rt.myId] || [];
  const [ranking, setRanking] = useState([]);
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 6,
      },
    })
  );

  const movieIdsStr = movies.map((m) => m.id).join(',');
  const myVoteStr = myVote.join(',');

  useEffect(() => {
    const ids = movies.map((m) => m.id);
    let seeded = [];

    // Load saved vote order from localStorage (keyed by roomId)
    const savedTitles = loadMyVoteOrder(rt.roomId);
    if (savedTitles && savedTitles.length > 0) {
      // Match by title
      savedTitles.forEach((title) => {
        const matchingMovie = movies.find((m) => m.title && title && m.title.toLowerCase() === title.toLowerCase());
        if (matchingMovie && !seeded.includes(matchingMovie.id)) {
          seeded.push(matchingMovie.id);
        }
      });
      // Append any movies that were not in the saved list
      movies.forEach((m) => {
        if (!seeded.includes(m.id)) {
          seeded.push(m.id);
        }
      });
    } else {
      // Fallback to myVote or default order
      seeded = [...myVote.filter((id) => ids.includes(id)), ...ids.filter((id) => !myVote.includes(id))];
    }

    setRanking(seeded);
  }, [movieIdsStr, myVoteStr, rt.roomId]);

  // Save ranking to localStorage whenever it changes
  useEffect(() => {
    if (ranking.length > 0 && rt.roomId) {
      // Map movie IDs in ranking to their corresponding titles
      const orderedTitles = ranking
        .map((id) => movies.find((m) => m.id === id)?.title)
        .filter(Boolean);
      saveMyVoteOrder(rt.roomId, orderedTitles);
    }
  }, [ranking, rt.roomId, movieIdsStr]);

  const byId = useMemo(() => new Map(movies.map((m) => [m.id, m])), [movies]);
  const votesIn = Object.keys(rt.state?.votes || {}).length;

  const submit = (e) => {
    e.preventDefault();
    actions.vote(ranking);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setRanking((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
    setActiveId(null);
  };

  const hasVoted = myVote.length > 0;

  if (hasVoted) {
    const activePeers = rt.state?.peers?.filter(p => p.connected !== false) || [];
    const votedCount = Object.keys(rt.state?.votes || {}).length;

    return (
      <section className="card p-5 text-center space-y-4 bg-panel border border-line rounded-2xl relative overflow-hidden">
        <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-accent2/20 blur-3xl" />

        <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto text-xl animate-bounce relative z-10">
          <i className="fa-solid fa-check" />
        </div>
        <div className="space-y-1 relative z-10">
          <h2 className="text-xl font-semibold text-white">Thanks for your votes!</h2>
          <p className="text-sm text-slate-400">Your ballot has been successfully submitted.</p>
        </div>

        <div className="border-t border-line my-4 relative z-10" />

        <div className="space-y-3 text-left max-w-sm mx-auto relative z-10">
          <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider mb-2">
            <span>Roster status</span>
            <span>{votedCount} / {activePeers.length} Voted</span>
          </div>

          <div className="space-y-2">
            {activePeers.map((p) => {
              const voted = Boolean(rt.state?.votes?.[p.id]);
              return (
                <div key={p.id} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-panel2 border border-line/50">
                  <span className={voted ? "text-slate-300" : "text-slate-100 font-medium"}>{p.name}</span>
                  <span className={`text-xs flex items-center gap-1.5 ${voted ? "text-emerald-400" : "text-amber-400"}`}>
                    {voted ? (
                      <>
                        <i className="fa-solid fa-circle-check" />
                        Voted
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                        Voting...
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {rt.isHost && (
          <div className="pt-2 flex justify-center gap-3 relative z-10">
            <button type="button" className="btn px-4 py-2 rounded-lg border border-line bg-panel2 text-xs text-rose-300 hover:text-rose-200" onClick={() => actions.cancelVoting()}>
              Cancel voting
            </button>
            <button type="button" className="btn px-4 py-2 rounded-lg border border-line bg-panel2 text-xs hover:bg-slate-800" onClick={() => actions.closeVoting()}>
              Close voting now
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-white mr-auto">Rank your ballot</h2>
        <div className="text-xs text-slate-400">Votes in: {votesIn}/{rt.state?.peers?.length || 0}</div>
        {rt.isHost && (
          <div className="flex gap-2">
            <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs text-rose-300" onClick={() => actions.cancelVoting()}>
              Cancel voting
            </button>
            <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={() => actions.closeVoting()}>
              Close voting now
            </button>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-2.5 px-2.5 sm:px-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(e.active.id)}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ranking} strategy={verticalListSortingStrategy}>
            {ranking.map((id, idx) => {
              const m = byId.get(id);
              if (!m) return null;
              const meta = movieMeta(m.title, m.tmdbId);
              return <SortableItem key={id} id={id} movie={m} meta={meta} index={idx} onOpenInfo={onOpenInfo} />;
            })}
          </SortableContext>
          <DragOverlay>
            {activeId && byId.get(activeId) ? (
              <div className="rank-row rounded-lg border border-line bg-panel2 p-2.5 opacity-80 scale-105 shadow-xl cursor-grabbing">
                <SortableItemContent
                  movie={byId.get(activeId)}
                  meta={movieMeta(byId.get(activeId).title, byId.get(activeId).tmdbId)}
                  index={ranking.indexOf(activeId)}
                  onOpenInfo={onOpenInfo}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <button type="submit" className="btn btn-primary px-3 py-2 rounded-lg text-white text-sm">
          Submit ranking
        </button>
      </form>
    </section>
  );
}
