import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_NAME_LEN } from '../lib/constants.js';
import { cleanName } from '../lib/constants.js';
import { saveName } from '../lib/storage.js';
import { actions, shareUrl } from '../state/controller.js';
import { useStore } from '../state/useStore.js';

export default function RoomBar() {
  const rt = useStore();
  const [name, setName] = useState(rt.myName || '');
  const [copied, setCopied] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrZoom, setQrZoom] = useState(false);
  const qrRef = useRef(null);
  const qrZoomRef = useRef(null);
  const scannerRef = useRef(null);
  const scannerId = 'qr-reader';
  const url = useMemo(() => shareUrl(), [rt.roomId]);

  useEffect(() => { setName(rt.myName || ''); }, [rt.myName]);

  // Render a QR code for the share URL into `el` at the given native pixel size.
  // qrcode.js paints a fixed-size canvas/img; CSS (.qr-box / .qr-box-zoom) then
  // scales it responsively — larger on mobile, enlarged in the zoom overlay.
  const renderQr = (el, size) => {
    if (!el || !window.QRCode) return;
    el.innerHTML = '';
    // eslint-disable-next-line no-new
    new window.QRCode(el, { text: url, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
  };

  useEffect(() => {
    if (!rt.isHost) return;
    renderQr(qrRef.current, 360);
  }, [rt.isHost, url]);

  useEffect(() => {
    if (!qrZoom) return;
    renderQr(qrZoomRef.current, 640);
  }, [qrZoom, url]);

  useEffect(() => {
    if (!scannerOpen || !window.Html5Qrcode) return undefined;
    let active = true;
    const scanner = new window.Html5Qrcode(scannerId);
    scannerRef.current = scanner;
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
      (decodedText) => {
        if (!active) return;
        const val = String(decodedText || '');
        if (val.includes('?room=')) window.location.href = val;
      },
      () => {},
    ).catch(() => {});
    return () => {
      active = false;
      scanner.stop().catch(() => {}).finally(() => scanner.clear().catch(() => {}));
    };
  }, [scannerOpen]);

  const submitName = (e) => {
    e.preventDefault();
    const n = cleanName(name);
    if (!n) return;
    actions.setName(n);
    saveName(n);
  };

  return (
    <section className="card p-4 sm:p-5 mb-4">
      <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Room</div>
          <div className="text-xl sm:text-2xl font-display text-white">{rt.roomId || '…'}</div>
          <form className="flex items-center gap-2" onSubmit={submitName}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LEN}
              className="w-56 max-w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm"
              placeholder="Your name"
              aria-label="Display name"
            />
            <button type="submit" className="btn btn-accent2 px-3 py-2 rounded-lg text-sm text-white">Save</button>
          </form>
        </div>

        {rt.isHost ? (
          <div className="flex gap-4 items-start">
            <div className="space-y-2">
              <div className="text-xs text-slate-400">Share link</div>
              <div className="flex items-center gap-2">
                <input value={url} readOnly className="bg-panel2 border border-line rounded-lg px-3 py-2 text-xs w-64 max-w-[62vw]" />
                <button
                  type="button"
                  className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1200); }
                    catch { /* ignore */ }
                  }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <button
              type="button"
              className="bg-white p-2 rounded-lg text-black qr-box self-center sm:self-start"
              onClick={() => setQrZoom(true)}
              aria-label="Enlarge join QR code"
              title="Tap to enlarge"
            >
              <div ref={qrRef} />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-slate-400">Join helper</div>
            <button type="button" className="btn px-3 py-2 rounded-lg border border-line bg-panel2 text-sm" onClick={() => setScannerOpen((v) => !v)}>
              <i className="fa-solid fa-qrcode mr-1.5" />
              {scannerOpen ? 'Close scanner' : 'Scan QR'}
            </button>
            {scannerOpen && <div id={scannerId} className="w-[260px] max-w-full overflow-hidden rounded-lg border border-line" />}
          </div>
        )}
      </div>

      {qrZoom && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setQrZoom(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged join QR code"
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
    </section>
  );
}
