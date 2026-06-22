import { useEffect, useRef } from 'react';
import Modal from '../ui/Modal.jsx';

export default function SyncModal({ open, onClose, syncId }) {
  const qrRef = useRef(null);
  const url = `${location.origin}${location.pathname}?sync=${syncId || ''}`;

  useEffect(() => {
    if (!open || !qrRef.current || !window.QRCode || !syncId) return;
    qrRef.current.innerHTML = '';
    // eslint-disable-next-line no-new
    new window.QRCode(qrRef.current, { text: url, width: 108, height: 108, correctLevel: window.QRCode.CorrectLevel.M });
  }, [open, syncId, url]);

  return (
    <Modal open={open} onClose={onClose} title="Sync preferences">
      <div className="space-y-3 text-sm text-slate-300">
        <p>Open this link on another device to import your local preferences.</p>
        {syncId ? (
          <>
            <input readOnly value={url} className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-xs" />
            <div className="rounded-lg bg-white p-2 inline-block text-black" ref={qrRef} />
          </>
        ) : (
          <p className="text-slate-400">Sync receive flow stubbed in this migration. Export/import still works fully.</p>
        )}
      </div>
    </Modal>
  );
}
