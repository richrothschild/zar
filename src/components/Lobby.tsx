import { useState } from 'react';
import { socket } from '../socket';
import type { RoomInfo } from '../types';
import HelpModal from './HelpModal';

type HelpTab = 'start' | 'rules' | 'tips';

interface LobbyProps {
  roomInfo: RoomInfo | null;
  myId: string;
  onStartGame: () => void;
}

// Read ?room=XXXXX from the URL on page load
function getRoomCodeFromUrl(): string {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
}

function inviteLink(roomId: string): string {
  return `${window.location.origin}${window.location.pathname}?room=${roomId}`;
}

function copyInviteLink(roomId: string) {
  navigator.clipboard.writeText(inviteLink(roomId));
}

export default function Lobby({ roomInfo, myId, onStartGame }: LobbyProps) {
  const [playerName, setPlayerName] = useState('');
  // Pre-fill join code from URL so clicking an invite link auto-populates it
  const [joinCode] = useState(getRoomCodeFromUrl);
  const [targetScore, setTargetScore] = useState(50);
  const [error, setError] = useState('');
  const [helpTab, setHelpTab] = useState<HelpTab | null>(null);

  const invitedRoomCode = joinCode; // non-empty when arriving via invite link

  function handleJoin(name: string, code: string) {
    if (!code.trim()) { setError('Enter a room code.'); return; }
    socket.connect();
    socket.emit('join_room', { roomId: code.trim().toUpperCase(), playerName: name.trim() });
  }

  function handleCreate(name: string) {
    socket.connect();
    socket.emit('create_room', { playerName: name.trim(), targetScore });
  }

  function submitName() {
    if (!playerName.trim()) { setError('Enter your name.'); return; }
    setError('');
    if (invitedRoomCode) {
      // Came via invite link — join directly, no extra screen
      handleJoin(playerName, invitedRoomCode);
    }
    // Otherwise stay on current screen to show Create / Join options
  }

  const isHost = roomInfo?.hostId === myId;

  // ── In-room lobby ──────────────────────────────────────────
  if (roomInfo) {
    return (
      <div className="lobby">
        {helpTab && <HelpModal initialTab={helpTab} onClose={() => setHelpTab(null)} />}
        <h1 className="lobby__title">ZAR</h1>

        <div className="lobby__room-code">
          Room: <strong>{roomInfo.roomId}</strong>
          <button
            className="btn btn--ghost"
            onClick={() => copyInviteLink(roomInfo.roomId)}
            title="Copy invite link"
          >
            📋 Copy invite link
          </button>
        </div>
        <p className="lobby__hint">Share the link above — friends click it and join instantly.</p>

        <div className="lobby__players">
          <h3>Players ({roomInfo.players.length}/9)</h3>
          {roomInfo.players.map(p => (
            <div key={p.id} className="lobby__player">
              {p.id === roomInfo.hostId ? '👑 ' : '👤 '}
              {p.name}
              {p.id === myId ? ' (you)' : ''}
              {!p.connected ? ' (disconnected)' : ''}
            </div>
          ))}
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
            {roomInfo.players.length < 2 && <p className="lobby__hint">Need at least 2 players.</p>}
          </div>
        ) : (
          <p className="lobby__waiting">Waiting for host to start the game…</p>
        )}

        <div className="lobby__help-buttons">
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('start')}>How to Get Started</button>
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('rules')}>Rules</button>
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('tips')}>Tips</button>
        </div>
      </div>
    );
  }

  // ── Invite link landing: just ask for a name, then auto-join ──
  if (invitedRoomCode) {
    return (
      <div className="lobby lobby--centered">
        {helpTab && <HelpModal initialTab={helpTab} onClose={() => setHelpTab(null)} />}
        <h1 className="lobby__title">ZAR</h1>
        <p className="lobby__tagline">You're invited to join room <strong>{invitedRoomCode}</strong></p>
        {error && <p className="lobby__error">{error}</p>}
        <input
          className="lobby__input"
          placeholder="Your name"
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submitName()}
          maxLength={20}
          autoFocus
        />
        <button className="btn btn--primary" onClick={submitName}>Join Game</button>

        <div className="lobby__help-buttons">
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('rules')}>Rules</button>
          <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('tips')}>Tips</button>
        </div>
      </div>
    );
  }

  // ── Default: enter name then create or join ─────────────────
  return (
    <div className="lobby lobby--centered">
      {helpTab && <HelpModal initialTab={helpTab} onClose={() => setHelpTab(null)} />}
      <h1 className="lobby__title">ZAR</h1>
      <p className="lobby__tagline">The addictive card game!</p>
      {error && <p className="lobby__error">{error}</p>}

      <input
        className="lobby__input"
        placeholder="Your name"
        value={playerName}
        onChange={e => setPlayerName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && playerName.trim()) setError('');
        }}
        maxLength={20}
        autoFocus
      />

      <div className="lobby__actions">
        <div className="lobby__action-block">
          <h3>Create a Room</h3>
          <div className="lobby__score-setting">
            <label>Target score: <strong>{targetScore}</strong></label>
            <input type="range" min={25} max={200} step={25} value={targetScore}
              onChange={e => setTargetScore(+e.target.value)} />
          </div>
          <button
            className="btn btn--primary"
            onClick={() => {
              if (!playerName.trim()) { setError('Enter your name first.'); return; }
              setError('');
              handleCreate(playerName);
            }}
          >
            Create Room
          </button>
        </div>

        <div className="lobby__divider">OR</div>

        <div className="lobby__action-block">
          <h3>Join with a code</h3>
          <JoinByCode
            playerName={playerName}
            onJoin={(code) => {
              if (!playerName.trim()) { setError('Enter your name first.'); return; }
              setError('');
              handleJoin(playerName, code);
            }}
          />
        </div>
      </div>

      <div className="lobby__help-buttons">
        <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('start')}>How to Get Started</button>
        <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('rules')}>Rules</button>
        <button className="btn btn--ghost lobby__help-btn" onClick={() => setHelpTab('tips')}>Tips</button>
      </div>
    </div>
  );
}

function JoinByCode({ playerName, onJoin }: { playerName: string; onJoin: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <>
      <input
        className="lobby__input lobby__input--code"
        placeholder="Room code"
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === 'Enter' && onJoin(code)}
        maxLength={5}
      />
      <button className="btn btn--secondary" onClick={() => onJoin(code)}
        disabled={!playerName.trim() || code.length < 5}>
        Join Room
      </button>
    </>
  );
}
