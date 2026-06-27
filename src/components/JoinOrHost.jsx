import React, { useState } from 'react';
import { actions } from '../state/controller.js';

export default function JoinOrHost() {
  const [roomIdInput, setRoomIdInput] = useState('');
  const [error, setError] = useState('');

  const handleHost = () => {
    actions.startHostingRoom();
  };

  const handleJoin = (e) => {
    e.preventDefault();
    const cleaned = String(roomIdInput || '').trim();
    if (!cleaned) {
      setError('Please enter a room code');
      return;
    }
    let finalId = cleaned.toLowerCase();
    if (!finalId.startsWith('room-')) {
      finalId = `room-${finalId}`;
    }
    actions.joinRoom(finalId);
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
                placeholder="e.g. room-abcd123"
                className="flex-1 bg-panel2 border border-line rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <button
                type="submit"
                className="btn bg-panel2 border border-line hover:bg-slate-800 text-slate-200 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
              >
                Join
              </button>
            </div>
            {error && <p className="text-xs text-rose-400 mt-1">{error}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}
