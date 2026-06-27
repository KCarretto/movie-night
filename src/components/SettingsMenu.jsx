import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/useStore.js';

export default function SettingsMenu({ onAction }) {
  const rt = useStore();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const items = [
    ['changeName', 'Change name'],
    ['export', 'Export data'],
    ['import', 'Import data'],
    ['importLetterboxd', 'Import Letterboxd'],
    ['sync', 'Sync preferences'],
    ['reset', 'Reset preferences'],
    ['deleteAll', 'Delete all data'],
  ];

  if (rt.isHost && rt.roomId) {
    items.push(['restartRoom', 'Restart room']);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        className="btn w-9 h-9 rounded-full border border-line bg-panel2 text-slate-200 hover:text-white"
        aria-label="Open settings"
        onClick={() => setOpen((v) => !v)}
      >
        <i className="fa-solid fa-gear" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu card p-1.5">
          {items.map(([key, label]) => (
            key === 'importLetterboxd' ? (
              <div key={key} className="flex items-center group relative whitespace-nowrap">
                <button
                  type="button"
                  className="flex-1 text-left px-3 py-2 rounded-md text-sm text-slate-200 hover:bg-panel2"
                  onClick={() => {
                    setOpen(false);
                    onAction?.(key);
                  }}
                >
                  {label}
                </button>
                <button
                  type="button"
                  aria-label="Letterboxd import instructions"
                  className="w-6 h-6 mr-1 rounded-full bg-panel2 border border-line flex items-center justify-center text-[11px] text-slate-300 flex-shrink-0"
                >
                  <i className="fa-solid fa-info" />
                </button>
                <div className="hidden group-hover:block absolute right-0 top-full pt-1 z-50 w-60 text-xs text-slate-300 leading-snug normal-case whitespace-normal">
                  <div className="card bg-panel p-3 shadow-xl">
                    You may export your data from Letterboxd <a href="https://letterboxd.com/settings/data/" target="_blank" rel="noopener noreferrer" className="text-accent2 underline">here</a>, then use this option to import the downloaded 'ratings.csv'.
                  </div>
                </div>
              </div>
            ) : (
              <button
                key={key}
                type="button"
                className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-panel2 ${key === 'restartRoom' ? 'text-rose-400 hover:text-rose-300 font-semibold' : 'text-slate-200'}`}
                onClick={() => {
                  setOpen(false);
                  onAction?.(key);
                }}
              >
                {label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}
