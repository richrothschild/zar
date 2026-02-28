import { useState } from 'react';
import { socket } from '../socket';
import type { RoomInfo } from '../types';
import HelpModal from './HelpModal';

type HelpTab = 'start' | 'rules' | 'tips';
type Step = 'name' | 'checking' | 'pick_room' | 'ask_host' | 'no_link';

interface AvailableRoom { roomId: string; hostName: string; playerCount: number; }

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
  const [availableRooms, setAvailableRooms] = useState<AvailableRoom[]>([]);

  const roomCode = getRoomCodeFromUrl();
  const isHost = roomInfo?.hostId === myId;

  function handleJoin() {
    if (!playerName.trim()) { setError('Enter your name.'); return; }
    setError('');
    if (roomCode) {
      // Invited via link — join directly
      socket.connect();
      socket.emit('join_room', { roomId: roomCode, playerName: playerName.trim() });
    } else {
      // No link — check for open rooms first
      if (!socket.connected) socket.connect();
      setStep('checking');
      socket.once('rooms_available', ({ rooms }: { rooms: AvailableRoom[] }) => {
        if (rooms.length > 0) {
          setAvailableRooms(rooms);
          setStep('pick_room');
        } else {
          setStep('ask_host');
        }
      });
      socket.emit('get_rooms');
    }
  }

  function handleJoinRoom(roomId: string) {
    socket.emit('join_room', { roomId, playerName: playerName.trim() });
  }

  function handleCreateRoom() {
    if (!socket.connected) socket.connect();
    socket.emit('create_room', { playerName: playerName.trim(), targetScore });
  }

  function goBackToName() {
    socket.off('rooms_available'); // cancel any pending listener
    setStep('name');
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

  // ── Checking for open rooms ──────────────────────────────────
  if (step === 'checking') {
    return (
      <div className="lobby lobby--centered">
        <h1 className="lobby__title">ZAR</h1>
        <p className="lobby__tagline">Looking for open games…</p>
      </div>
    );
  }

  // ── Open rooms found: ask to join ────────────────────────────
  if (step === 'pick_room') {
    return (
      <div className="lobby lobby--centered">
        {helpTab && <HelpModal initialTab={helpTab} onClose={() => setHelpTab(null)} />}
        <h1 className="lobby__title">ZAR</h1>
        <p className="lobby__tagline">Hi <strong>{playerName}</strong>!</p>

        {availableRooms.length === 1 ? (
          <>
            <p className="lobby__tagline" style={{ fontSize: '1rem' }}>
              Join <strong>{availableRooms[0].hostName}</strong>'s game?{' '}
              <span className="lobby__hint" style={{ display: 'inline' }}>
                ({availableRooms[0].playerCount} player{availableRooms[0].playerCount !== 1 ? 's' : ''})
              </span>
            </p>
            <div className="lobby__ask-host-actions">
              <button className="btn btn--primary" onClick={() => handleJoinRoom(availableRooms[0].roomId)}>
                Yes, join!
              </button>
              <button className="btn btn--ghost" onClick={() => setStep('ask_host')}>
                No, create my own game
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="lobby__tagline" style={{ fontSize: '1rem' }}>Pick a game to join:</p>
            <div className="lobby__room-list">
              {availableRooms.map(r => (
                <button
                  key={r.roomId}
                  className="btn btn--primary lobby__room-option"
                  onClick={() => handleJoinRoom(r.roomId)}
                >
                  {r.hostName}'s game &nbsp;
                  <span className="lobby__room-count">({r.playerCount} player{r.playerCount !== 1 ? 's' : ''})</span>
                </button>
              ))}
              <button className="btn btn--ghost" onClick={() => setStep('ask_host')}>
                Create my own game
              </button>
            </div>
          </>
        )}

        <div className="lobby__help-buttons">
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('start')}>How to Get Started</button>
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('rules')}>Rules</button>
        </div>
      </div>
    );
  }

  // ── No rooms found: ask if they want to host ─────────────────
  if (step === 'ask_host') {
    return (
      <div className="lobby lobby--centered">
        {helpTab && <HelpModal initialTab={helpTab} onClose={() => setHelpTab(null)} />}
        <h1 className="lobby__title">ZAR</h1>
        <p className="lobby__tagline">Hi <strong>{playerName}</strong>! No open games found.</p>
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

  // ── No invite link and declined hosting ──────────────────────
  if (step === 'no_link') {
    return (
      <div className="lobby lobby--centered">
        <h1 className="lobby__title">ZAR</h1>
        <p className="lobby__tagline">Ask the host to share their invite link with you.</p>
        <p className="lobby__hint">The host will see a <strong>"📋 Copy invite link"</strong> button in their lobby.</p>
        <button className="btn btn--ghost" onClick={goBackToName}>← Back</button>
      </div>
    );
  }

  // ── Default: enter name ──────────────────────────────────────
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
