import { MAX_NOMINATIONS, MAX_PEERS } from '../lib/constants.js';
import { useStore } from '../state/useStore.js';

export default function Lobby() {
  const rt = useStore();
  const peers = rt.state?.peers || [];
  const movies = rt.state?.movies || [];

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold text-white">Lobby</h2>
        <div className="text-xs text-slate-300">{peers.length}/{MAX_PEERS} connected · {MAX_NOMINATIONS} picks each</div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {peers.map((p) => {
          const count = movies.filter((m) => m.by === p.id).length;
          return (
            <div key={p.id} className="rounded-lg border border-line bg-panel2 px-3 py-2 flex items-center justify-between gap-2">
              <div className="truncate text-sm text-slate-100">{p.name}</div>
              <div className="text-xs text-slate-400">{count}/{MAX_NOMINATIONS}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
