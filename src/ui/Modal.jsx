export default function Modal({ open, onClose, title, children, className = '' }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`card w-full max-w-xl p-4 sm:p-5 max-h-[90vh] overflow-y-auto ${className}`.trim()} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button type="button" className="text-slate-400 hover:text-white" onClick={onClose} aria-label="Close modal">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
