import { useEffect, useRef, useState } from 'react';

const ITEMS = [
  ['changeName', 'Change name'],
  ['export', 'Export data'],
  ['import', 'Import data'],
  ['importLetterboxd', 'Import Letterboxd'],
  ['sync', 'Sync preferences'],
  ['reset', 'Reset preferences'],
  ['deleteAll', 'Delete all data'],
];

export default function SettingsMenu({ onAction }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

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
          {ITEMS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="w-full text-left px-3 py-2 rounded-md text-sm text-slate-200 hover:bg-panel2"
              onClick={() => {
                setOpen(false);
                onAction?.(key);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
