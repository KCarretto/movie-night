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
          const isOffline = p.connected === false;
          return (
            <div
              key={p.id}
              className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 transition-opacity ${
                isOffline ? 'border-line/40 bg-panel2/40 opacity-50' : 'border-line bg-panel2'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    isOffline ? 'bg-slate-500' : 'bg-emerald-400 pulse'
                  }`}
                  aria-hidden="true"
                />
                <div className={`truncate text-sm ${isOffline ? 'text-slate-400' : 'text-slate-100'}`}>
                  {p.name} {isOffline && <span className="text-[10px] text-slate-500 font-normal italic ml-1">(offline)</span>}
                </div>
              </div>
              <div className="text-xs text-slate-400">{count}/{MAX_NOMINATIONS}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
