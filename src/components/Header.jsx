import { useStore } from '../state/useStore.js';
import NetStatus from './NetStatus.jsx';
import SettingsMenu from './SettingsMenu.jsx';

export default function Header({ showHistory, onToggleHistory, onSettingsAction }) {
  const rt = useStore();
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-ink/75 backdrop-blur">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
        <button type="button" className="flex items-center gap-2 min-w-0" onClick={() => onToggleHistory(false)}>
          <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white">
            <i className="fa-solid fa-film" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-2xl leading-none text-white">Plot Polls</span>
            <span className="block text-[11px] text-slate-400 leading-none">Ranked-choice movie night</span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <NetStatus />
          <div className="hidden sm:block text-xs text-slate-300">You are <b className="text-white">{rt.myName || '…'}</b></div>
          <button
            type="button"
            className={`btn px-3 py-2 rounded-lg border text-sm ${showHistory ? 'bg-accent2/20 border-accent2 text-white' : 'bg-panel2 border-line text-slate-200'}`}
            onClick={() => onToggleHistory(!showHistory)}
          >
            <i className={`fa-solid ${showHistory ? 'fa-house' : 'fa-clock-rotate-left'} mr-1.5`} />
            {showHistory ? 'Room' : 'History'}
          </button>
          <SettingsMenu onAction={onSettingsAction} />
        </div>
      </div>
    </header>
  );
}
