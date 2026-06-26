import React, { useEffect, useMemo, useState } from 'react';
import { movieMeta } from '../lib/catalog.js';
import GenreTags from '../ui/GenreTags.jsx';
import LanguageBadge from '../ui/LanguageBadge.jsx';
import Poster from '../ui/Poster.jsx';
import { actions } from '../state/controller.js';
import { useStore } from '../state/useStore.js';
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableItemContent({ movie, meta, index }) {
  return (
    <div className="flex items-start gap-2">
      <div className="drag-handle text-slate-500 mt-0.5">
        <i className="fa-solid fa-grip-vertical" />
      </div>
      <div className="text-xs text-slate-400 mt-1">#{index + 1}</div>
      <Poster movie={meta || movie} className="w-10 h-14 rounded flex-none" />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-100">{movie.title}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
          {meta && <GenreTags movie={meta} />}
          {meta && <LanguageBadge movie={meta} />}
        </div>
      </div>
    </div>
  );
}

function SortableItem({ id, movie, meta, index }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    touchAction: 'none',
    cursor: 'grab',
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="rank-row rounded-lg border border-line bg-panel2 p-2.5">
      <SortableItemContent movie={movie} meta={meta} index={index} />
    </div>
  );
}

export default function Vote() {
  const rt = useStore();
  const movies = rt.state?.movies || [];
  const myVote = rt.state?.votes?.[rt.myId] || [];
  const [ranking, setRanking] = useState([]);
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(useSensor(PointerSensor));

  const movieIdsStr = movies.map((m) => m.id).join(',');
  const myVoteStr = myVote.join(',');

  useEffect(() => {
    const ids = movies.map((m) => m.id);
    const seeded = [...myVote.filter((id) => ids.includes(id)), ...ids.filter((id) => !myVote.includes(id))];
    setRanking(seeded);
  }, [movieIdsStr, myVoteStr]);

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

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-white mr-auto">Rank your ballot</h2>
        <div className="text-xs text-slate-400">Votes in: {votesIn}/{rt.state?.peers?.length || 0}</div>
        {rt.isHost && (
          <button type="button" className="btn px-3 py-1.5 rounded-lg border border-line bg-panel2 text-xs" onClick={() => actions.closeVoting()}>
            Close voting now
          </button>
        )}
      </div>

      <form onSubmit={submit} className="space-y-2.5">
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
              return <SortableItem key={id} id={id} movie={m} meta={meta} index={idx} />;
            })}
          </SortableContext>
          <DragOverlay>
            {activeId && byId.get(activeId) ? (
              <div className="rank-row rounded-lg border border-line bg-panel2 p-2.5 opacity-80 scale-105 shadow-xl cursor-grabbing">
                <SortableItemContent
                  movie={byId.get(activeId)}
                  meta={movieMeta(byId.get(activeId).title, byId.get(activeId).tmdbId)}
                  index={ranking.indexOf(activeId)}
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
