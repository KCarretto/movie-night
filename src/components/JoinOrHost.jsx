import React, { useState, useEffect, useRef } from 'react';
import { actions } from '../state/controller.js';

export default function JoinOrHost() {
  const [roomIdInput, setRoomIdInput] = useState('');
  const [error, setError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const qrScannerRef = useRef(null);

  // Load the QR scanning library dynamically from unpkg CDN
  useEffect(() => {
    if (window.Html5Qrcode) return;
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/html5-qrcode';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  // Guarantee the camera is stopped when the component is unmounted
  useEffect(() => {
    return () => {
      if (qrScannerRef.current) {
        try { qrScannerRef.current.stop(); } catch (e) {}
      }
    };
  }, []);

  const handleHost = () => {
    actions.startHostingRoom();
  };

  const handleJoin = (e) => {
    e?.preventDefault();
    const cleaned = String(roomIdInput || '').trim();
    if (!cleaned) {
      setError('Please enter a room code');
      return;
    }
    let finalId = cleaned.toLowerCase();
    if (finalId.startsWith('room-')) {
      finalId = finalId.slice(5);
    }
    actions.joinRoom(finalId);
  };

  const startScanner = () => {
    if (!window.Html5Qrcode) {
      setError('Scanner library is loading, please try again.');
      return;
    }
    setIsScanning(true);
    setScanError('');

    setTimeout(() => {
      const html5QrCode = new window.Html5Qrcode("reader");
      qrScannerRef.current = html5QrCode;

      html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          let roomId = decodedText;
          try {
            const url = new URL(decodedText);
            const roomParam = url.searchParams.get('room');
            if (roomParam) {
              roomId = roomParam;
            }
          } catch (e) {
            // Raw text fallback
          }

          const cleaned = String(roomId || '').trim();
          let finalId = cleaned.toLowerCase();
          if (finalId.startsWith('room-')) {
            finalId = finalId.slice(5);
          }
          setRoomIdInput(finalId);
          
          html5QrCode.stop().then(() => {
            setIsScanning(false);
            qrScannerRef.current = null;
          }).catch(() => {
            setIsScanning(false);
            qrScannerRef.current = null;
          });
        },
        () => {
          // ignore scan frame check errors
        }
      ).catch((err) => {
        console.error('Failed to start QR scanner:', err);
        setScanError('Camera access denied or no camera device found.');
      });
    }, 100);
  };

  const stopScanner = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop().then(() => {
        setIsScanning(false);
        qrScannerRef.current = null;
      }).catch(() => {
        setIsScanning(false);
        qrScannerRef.current = null;
      });
    } else {
      setIsScanning(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="card p-6 sm:p-8 space-y-6 text-center bg-panel border border-line shadow-2xl relative overflow-hidden rounded-2xl">
        {/* Glow effect decoration */}
        <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-accent2/20 blur-3xl" />

        <div className="space-y-2 relative z-10">
          <span className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-accent2 flex items-center justify-center text-white text-xl mx-auto mb-2 shadow-lg">
            <i className="fa-solid fa-film" aria-hidden="true" />
          </span>
          <h1 className="text-3xl font-display uppercase tracking-wider text-white">Plot Polls</h1>
          <p className="text-sm text-slate-300">Ranked-choice movie nights made simple.</p>
        </div>

        <div className="border-t border-line my-4" />

        <div className="space-y-4 relative z-10">
          <div className="text-left space-y-2">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Host a Movie Night</h2>
            <p className="text-xs text-slate-400">Start a new lobby as the host. You can invite friends, nominate movies, and control the voting.</p>
            <button
              onClick={handleHost}
              className="w-full btn bg-gradient-to-r from-accent to-accent2 hover:brightness-110 active:scale-95 text-white font-medium py-3 px-4 rounded-xl text-sm transition-all duration-200 shadow-md shadow-accent/20 flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-play" />
              Create & Host Room
            </button>
          </div>

          <div className="flex items-center my-6">
            <div className="flex-1 border-t border-line" />
            <span className="px-3 text-xs text-slate-500 uppercase tracking-widest">or</span>
            <div className="flex-1 border-t border-line" />
          </div>

          <form onSubmit={handleJoin} className="text-left space-y-3">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Join a Movie Night</h2>
            <p className="text-xs text-slate-400">Enter the room code shared by your host to join an active session.</p>
            
            <div className="flex gap-2">
              <input
                type="text"
                value={roomIdInput}
                onChange={(e) => {
                  setRoomIdInput(e.target.value);
                  setError('');
                }}
                placeholder="e.g. epic-popcorn"
                className="flex-1 bg-panel2 border border-line rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={isScanning ? stopScanner : startScanner}
                className={`btn border p-2.5 rounded-xl text-sm transition-colors flex items-center justify-center ${isScanning ? 'bg-rose-500/20 border-rose-500 text-rose-300 animate-pulse' : 'bg-panel2 border-line hover:bg-slate-800 text-slate-200'}`}
                title="Scan QR Code"
              >
                <i className={`fa-solid ${isScanning ? 'fa-xmark' : 'fa-camera'} text-base`} />
              </button>
              <button
                type="submit"
                className="btn bg-panel2 border border-line hover:bg-slate-800 text-slate-200 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
              >
                Join
              </button>
            </div>
            {error && <p className="text-xs text-rose-400 mt-1">{error}</p>}

            {isScanning && (
              <div className="space-y-2 mt-4 p-3 border border-line rounded-2xl bg-panel2 relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-200">Scan QR Code</span>
                  <button
                    type="button"
                    onClick={stopScanner}
                    className="text-slate-400 hover:text-slate-200 text-xs"
                  >
                    Close
                  </button>
                </div>
                <div id="reader" className="overflow-hidden rounded-xl bg-black" style={{ width: '100%', minHeight: '250px' }} />
                {scanError && <p className="text-xs text-rose-400 mt-1">{scanError}</p>}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
