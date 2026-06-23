import { useEffect, useRef, useState } from 'react';

// A compact multi-select dropdown: a pill button that opens a checkbox menu.
// Used for the recommendation genre / language mood filters (OR within a group).
export default function MultiSelect({
  icon, allText = 'All', countSuffix = 'selected', options = [], selected = [], onChange,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [open]);

  const label = !selected.length
    ? allText
    : (selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label || selected[0])
      : `${selected.length} ${countSuffix}`);

  const toggle = (value) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange?.(next);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        className="btn bg-panel2 border border-line text-xs font-semibold px-2.5 py-1.5 rounded-lg inline-flex items-center"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        {icon ? <i className={`${icon} mr-1.5`} aria-hidden="true" /> : null}
        <span>{label}</span>
        <i className="fa-solid fa-chevron-down ml-1.5 text-[10px]" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute z-30 left-0 mt-1 card p-2 w-52 max-h-64 overflow-auto space-y-0.5">
          {options.length === 0 && <div className="px-2 py-1 text-xs text-slate-500">No options</div>}
          {options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer hover:bg-panel2 text-xs">
              <input
                type="checkbox"
                className="accent-accent2"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
