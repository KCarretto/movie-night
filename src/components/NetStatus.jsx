import { useStore } from '../state/useStore.js';

export default function NetStatus() {
  const rt = useStore();
  const level = rt.netStatus?.level || 'warn';
  const tone = level === 'ok' ? 'bg-emerald-400' : level === 'err' ? 'bg-rose-400' : 'bg-amber-400';

  const activePeers = (rt.state?.peers || []).filter((p) => p.connected !== false);
  const peerNames = activePeers.map((p) => p.name).join(', ') || 'None';

  const debugInfo = [
    `Role: ${rt.isHost ? 'Host' : 'Guest'}`,
    `Room ID: ${rt.roomId || 'None'}`,
    `My ID: ${rt.myId || 'None'}`,
    `Connections: ${rt.connCount || 0}`,
    `Connected Peers: ${peerNames}`,
    `Phase: ${rt.state?.phase || 'Unknown'}`
  ].join('\n');

  return (
    <div className="flex items-center gap-2 text-xs text-slate-300 cursor-help" aria-live="polite" title={debugInfo}>
      <span className={`dot pulse ${tone}`} aria-hidden="true" />
      <span>{rt.netStatus?.text || 'Connecting…'}</span>
    </div>
  );
}
