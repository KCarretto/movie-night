import Modal from '../ui/Modal.jsx';

export default function ImportConfirmModal({ open, summary, onClose, onConfirm }) {
  return (
    <Modal open={open} onClose={onClose} title="Import data">
      <p className="text-sm text-slate-300 mb-3">This will merge local data with imported records.</p>
      <ul className="text-sm text-slate-400 list-disc pl-5 mb-4 space-y-1">
        <li>History: {summary?.history ?? 0}</li>
        <li>Watched: {summary?.watched ?? 0}</li>
        <li>Watchlist: {summary?.watchlist ?? 0}</li>
        <li>Interested: {summary?.interested ?? 0}</li>
      </ul>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary px-3 py-2 rounded-lg text-sm text-white" onClick={onConfirm}>Import</button>
      </div>
    </Modal>
  );
}
