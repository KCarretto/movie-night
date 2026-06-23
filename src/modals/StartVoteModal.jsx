import Modal from '../ui/Modal.jsx';

export default function StartVoteModal({ open, movieCount, onClose, onConfirm }) {
  return (
    <Modal open={open} onClose={onClose} title="Start voting?">
      <p className="text-sm text-slate-300 mb-4">
        Lock nominations and open ranked voting for <b>{movieCount}</b> movie choices.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary px-3 py-2 rounded-lg text-sm text-white" onClick={onConfirm}>Start voting</button>
      </div>
    </Modal>
  );
}
