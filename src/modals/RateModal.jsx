import { useEffect, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import StarRating from '../ui/StarRating.jsx';

export default function RateModal({ open, title, initial = 0, onClose, onSave }) {
  const [value, setValue] = useState(initial || 0);
  useEffect(() => setValue(initial || 0), [initial, open]);

  return (
    <Modal open={open} onClose={onClose} title="Rate movie">
      <div className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Movie</div>
          <div className="text-white font-medium">{title}</div>
        </div>
        <StarRating value={value} onChange={setValue} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary px-3 py-2 rounded-lg text-sm text-white" onClick={() => onSave?.(value)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
