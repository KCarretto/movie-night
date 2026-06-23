import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import {
  destroySyncPeer, extractSyncId, startSyncReceive, startSyncShare,
} from '../lib/syncpeer.js';

// Fixed element ID for the Html5Qrcode camera scanner container.
const READER_ID = 'sync-qr-reader';

// view: 'picker' | 'share' | 'receive' | 'receiving'
export default function SyncModal({ open, onClose, buildPayload, onImport }) {
  const [view, setView] = useState('picker');
  const [shareUrl, setShareUrl] = useState('');
  const [status, setStatus] = useState('');
  const [qrZoom, setQrZoom] = useState(false);
  const qrRef = useRef(null);
  const qrZoomRef = useRef(null);
  const scannerRef = useRef(null);
  const syncCleanupRef = useRef(null);
  // Keep a ref to the latest buildPayload so the share effect never re-fires
  // just because the parent re-rendered with a new function identity.
  const buildPayloadRef = useRef(buildPayload);
  useEffect(() => { buildPayloadRef.current = buildPayload; });

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try { await s.stop(); s.clear(); } catch (e) {}
  }, []);

  const doCleanup = useCallback(() => {
    stopScanner();
    destroySyncPeer();
    if (typeof syncCleanupRef.current === 'function') {
      syncCleanupRef.current();
      syncCleanupRef.current = null;
    }
  }, [stopScanner]);

  // Reset everything when modal closes.
  useEffect(() => {
    if (!open) {
      doCleanup();
      setView('picker');
      setShareUrl('');
      setStatus('');
      setQrZoom(false);
    }
  }, [open, doCleanup]);

  // Share mode: start PeerJS host peer.
  useEffect(() => {
    if (!open || view !== 'share') return;
    setStatus('Starting\u2026');
    setShareUrl('');
    startSyncShare({
      buildPayload: () => buildPayloadRef.current?.(),
      onReady: (url) => setShareUrl(url),
      onStatus: setStatus,
    });
    return () => destroySyncPeer();
  }, [open, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render a QR code for `shareUrl` into `el` at the given native pixel size.
  // qrcode.js paints a fixed-size canvas/img; CSS then scales it responsively.
  const renderQr = useCallback((el, size) => {
    if (!el || !shareUrl || !window.QRCode) return;
    el.innerHTML = '';
    try {
      // eslint-disable-next-line no-new
      new window.QRCode(el, {
        text: shareUrl,
        width: size,
        height: size,
        correctLevel: window.QRCode.CorrectLevel.M,
      });
    } catch (e) {
      el.textContent = 'QR error';
    }
  }, [shareUrl]);

  // Render QR code once the share URL is ready (high native res so the
  // responsive CSS scaling stays crisp on large mobile displays).
  useEffect(() => {
    renderQr(qrRef.current, 360);
  }, [shareUrl, renderQr]);

  // Render the enlarged QR when the zoom dialog opens.
  useEffect(() => {
    if (!qrZoom) return;
    renderQr(qrZoomRef.current, 640);
  }, [qrZoom, renderQr]);

  // Receive mode: start Html5Qrcode camera scanner.
  useEffect(() => {
    if (!open || view !== 'receive') return;
    setStatus('');
    let cancelled = false;

    (async () => {
      if (!window.Html5Qrcode) { setStatus('Camera scanner unavailable.'); return; }
      const scanner = new window.Html5Qrcode(READER_ID);
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 200, height: 200 } },
          async (decoded) => {
            if (cancelled) return;
            const id = extractSyncId(decoded);
            if (!id) return;
            cancelled = true;
            await stopScanner();
            setView('receiving');
            setStatus('Connecting\u2026');
            const cleanup = startSyncReceive({
              hostId: id,
              onStatus: setStatus,
              onData: (payload) => {
                if (typeof syncCleanupRef.current === 'function') {
                  syncCleanupRef.current();
                  syncCleanupRef.current = null;
                }
                onClose?.();
                onImport?.(payload);
              },
              onError: setStatus,
            });
            syncCleanupRef.current = cleanup;
          },
          () => {}
        );
      } catch (e) {
        if (!cancelled) setStatus('Camera unavailable. Please allow camera access.');
      }
    })();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [open, view, stopScanner, onClose, onImport]);

  const handleClose = () => {
    doCleanup();
    onClose?.();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Sync preferences">

      {view === 'picker' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-400 mb-3">Transfer your ratings and watchlist to another device over a direct P2P connection.</p>
          <button
            type="button"
            className="btn btn-accent2 text-white text-sm font-semibold w-full px-4 py-2.5 rounded-lg"
            onClick={() => setView('share')}
          >
            <i className="fa-solid fa-qrcode mr-2" aria-hidden="true" />
            Share this device&rsquo;s data
          </button>
          <button
            type="button"
            className="btn bg-panel2 border border-line text-sm font-semibold w-full px-4 py-2.5 rounded-lg"
            onClick={() => setView('receive')}
          >
            <i className="fa-solid fa-camera mr-2" aria-hidden="true" />
            Receive data (scan a code)
          </button>
        </div>
      )}

      {view === 'share' && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-slate-400">Scan this QR code from your other device, or copy the link.</p>
          {shareUrl ? (
            <>
              <div className="flex justify-center">
                <button
                  type="button"
                  className="bg-white p-3 rounded-xl inline-block qr-box"
                  onClick={() => setQrZoom(true)}
                  aria-label="Enlarge QR code"
                  title="Tap to enlarge"
                >
                  <div ref={qrRef} />
                </button>
              </div>
              <p className="text-xs text-slate-500">Tap the code to enlarge it.</p>
              <input
                readOnly
                value={shareUrl}
                className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-xs"
                onFocus={(e) => e.target.select()}
              />
            </>
          ) : (
            <div className="py-6 flex justify-center">
              <span className="spinner" aria-hidden="true" />
            </div>
          )}
          <p className="text-xs text-slate-400 min-h-[1.25rem]">{status}</p>
          <button
            type="button"
            className="btn bg-panel2 border border-line text-sm px-4 py-2 rounded-lg w-full"
            onClick={() => { destroySyncPeer(); setView('picker'); }}
          >
            &larr; Back
          </button>
        </div>
      )}

      {view === 'receive' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Point your camera at the QR code shown on the other device.</p>
          {/* Html5Qrcode injects its camera feed into this element by ID */}
          <div id={READER_ID} className="rounded-xl overflow-hidden" />
          {status && <p className="text-xs text-slate-400 text-center">{status}</p>}
          <button
            type="button"
            className="btn bg-panel2 border border-line text-sm px-4 py-2 rounded-lg w-full"
            onClick={() => { stopScanner(); setView('picker'); }}
          >
            &larr; Back
          </button>
        </div>
      )}

      {view === 'receiving' && (
        <div className="space-y-4 text-center py-4">
          <div className="flex justify-center">
            <span className="spinner" aria-hidden="true" />
          </div>
          <p className="text-sm text-slate-300">{status || 'Connecting\u2026'}</p>
        </div>
      )}
      {qrZoom && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setQrZoom(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged QR code"
        >
          <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white p-4 rounded-2xl qr-box-zoom">
              <div ref={qrZoomRef} />
            </div>
            <button
              type="button"
              className="btn bg-panel2 border border-line text-sm px-5 py-2 rounded-lg text-slate-200"
              onClick={() => setQrZoom(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

    </Modal>
  );
}
