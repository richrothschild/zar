import { useState } from 'react';
import { socket } from '../socket';
import type { RoomInfo } from '../types';
import HelpModal from './HelpModal';

type HelpTab = 'start' | 'rules' | 'tips';
type Step = 'name' | 'ask_host' | 'no_link';

interface LobbyProps {
  roomInfo: RoomInfo | null;
  myId: string;
  onStartGame: () => void;
}

function getRoomCodeFromUrl(): string {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
}

function inviteLink(roomId: string): string {
  return `${window.location.origin}${window.location.pathname}?room=${roomId}`;
}

export default function Lobby({ roomInfo, myId, onStartGame }: LobbyProps) {
  const [playerName, setPlayerName] = useState('');
  const [targetScore, setTargetScore] = useState(50);
  const [error, setError] = useState('');
  const [step, setStep] = useState<Step>('name');
  const [helpTab, setHelpTab] = useState<HelpTab | null>(null);

  const roomCode = getRoomCodeFromUrl();
  const isHost = roomInfo?.hostId === myId;

  function handleJoin() {
    if (!playerName.trim()) { setError('Enter your name.'); return; }
    setError('');
    if (roomCode) {
      socket.connect();
      socket.emit('join_room', { roomId: roomCode, playerName: playerName.trim() });
    } else {
      // No invite link — ask if they want to host
      setStep('ask_host');
    }
  }

  function handleCreateRoom() {
    socket.connect();
    socket.emit('create_room', { playerName: playerName.trim(), targetScore });
  }

  // ── In-room lobby ───────────────────────────────────────────
  if (roomInfo) {
    return (
      <div className="lobby">
        {helpTab && <HelpModal initialTab={helpTab} onClose={() => setHelpTab(null)} />}
        <h1 className="lobby__title">ZAR</h1>

        {isHost && (
          <div className="lobby__invite">
            <button
              className="btn btn--secondary lobby__invite-btn"
              onClick={() => navigator.clipboard.writeText(inviteLink(roomInfo.roomId))}
            >
              📋 Copy invite link
            </button>
            <p className="lobby__hint">Share this link — friends click it and join instantly.</p>
          </div>
        )}

        <div className="lobby__players">
          <h3>Players ({roomInfo.players.length}/9)</h3>
          {roomInfo.players.map(p => (
            <div key={p.id} className="lobby__player">
              {p.id === roomInfo.hostId ? '👑 ' : '👤 '}
              {p.name}
              {p.id === myId ? ' (you)' : ''}
              {!p.connected ? ' (disconnected)' : ''}
              {p.isBot ? ' 🤖' : ''}
            </div>
          ))}
          {roomInfo.spectators?.length > 0 && (
            <>
              <h3 style={{ marginTop: '1rem' }}>Watching</h3>
              {roomInfo.spectators.map(s => (
                <div key={s.id} className="lobby__player" style={{ opacity: 0.6 }}>
                  👁 {s.name}
                </div>
              ))}
            </>
          )}
        </div>

        {isHost ? (
          <div className="lobby__start">
            <div className="lobby__score-setting">
              <label>Play to: <strong>{targetScore}</strong> points</label>
              <input type="range" min={25} max={200} step={25} value={targetScore}
                onChange={e => setTargetScore(+e.target.value)} />
            </div>
            <button
              className="btn btn--primary"
              onClick={onStartGame}
              disabled={roomInfo.players.length < 2}
            >
              Start Game
            </button>
            {roomInfo.players.length < 2 && (
              <p className="lobby__hint">Need at least 2 players. Share your invite link!</p>
            )}
          </div>
        ) : (
          <p className="lobby__waiting">Waiting for the host to start…</p>
        )}

        <div className="lobby__help-buttons">
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('start')}>How to Get Started</button>
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('rules')}>Rules</button>
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('tips')}>Tips</button>
        </div>
      </div>
    );
  }

  // ── No invite link: ask if they want to host ────────────────
  if (step === 'ask_host') {
    return (
      <div className="lobby lobby--centered">
        {helpTab && <HelpModal initialTab={helpTab} onClose={() => setHelpTab(null)} />}
        <h1 className="lobby__title">ZAR</h1>
        <p className="lobby__tagline">Hi <strong>{playerName}</strong>! No game found to join.</p>
        <p className="lobby__tagline" style={{ fontSize: '1rem' }}>Would you like to host a new game?</p>

        <div className="lobby__ask-host-actions">
          <div className="lobby__score-setting">
            <label>Play to: <strong>{targetScore}</strong> points</label>
            <input type="range" min={25} max={200} step={25} value={targetScore}
              onChange={e => setTargetScore(+e.target.value)} />
          </div>
          <button className="btn btn--primary" onClick={handleCreateRoom}>
            Yes, I'll host
          </button>
          <button className="btn btn--ghost" onClick={() => setStep('no_link')}>
            No, I need an invite link
          </button>
        </div>

        <div className="lobby__help-buttons">
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('start')}>How to Get Started</button>
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('rules')}>Rules</button>
        </div>
      </div>
    );
  }

  // ── No invite link and declined hosting ─────────────────────
  if (step === 'no_link') {
    return (
      <div className="lobby lobby--centered">
        <h1 className="lobby__title">ZAR</h1>
        <p className="lobby__tagline">Ask the host to share their invite link with you.</p>
        <p className="lobby__hint">The host will see a <strong>"📋 Copy invite link"</strong> button in their lobby.</p>
        <button className="btn btn--ghost" onClick={() => setStep('name')}>← Back</button>
      </div>
    );
  }

  // ── Default: enter name + join ──────────────────────────────
  return (
    <div className="lobby lobby--centered">
      {helpTab && <HelpModal initialTab={helpTab} onClose={() => setHelpTab(null)} />}
      <h1 className="lobby__title">ZAR</h1>

      {roomCode
        ? <p className="lobby__tagline">You're invited! Enter your name to join.</p>
        : <p className="lobby__tagline">The addictive card game!</p>
      }

      {error && <p className="lobby__error">{error}</p>}

      <input
        className="lobby__input"
        placeholder="Your name"
        value={playerName}
        onChange={e => setPlayerName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleJoin()}
        maxLength={20}
        autoFocus
      />

      <button className="btn btn--primary" onClick={handleJoin}>
        {roomCode ? 'Join Game' : 'Continue'}
      </button>

      <div className="lobby__help-buttons">
        <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('start')}>How to Get Started</button>
        <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('rules')}>Rules</button>
        <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('tips')}>Tips</button>
      </div>
    </div>
  );
}
