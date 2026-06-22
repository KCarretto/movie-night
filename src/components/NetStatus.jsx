import { useStore } from '../state/useStore.js';

export default function NetStatus() {
  const rt = useStore();
  const level = rt.netStatus?.level || 'warn';
  const tone = level === 'ok' ? 'bg-emerald-400' : level === 'err' ? 'bg-rose-400' : 'bg-amber-400';
  return (
    <div className="flex items-center gap-2 text-xs text-slate-300" aria-live="polite">
      <span className={`dot pulse ${tone}`} aria-hidden="true" />
      <span>{rt.netStatus?.text || 'Connecting…'}</span>
    </div>
  );
}
