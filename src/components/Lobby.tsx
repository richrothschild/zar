import { useState } from 'react';
import { socket } from '../socket';
import type { RoomInfo } from '../types';

interface LobbyProps {
  roomInfo: RoomInfo | null;
  myId: string;
  onStartGame: () => void;
}

export default function Lobby({ roomInfo, myId, onStartGame }: LobbyProps) {
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [targetScore, setTargetScore] = useState(50);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'name' | 'room'>('name');
  function submitName() {
    if (!playerName.trim()) { setError('Enter your name.'); return; }
    setError('');
    setStep('room');
  }

  function handleCreate() {
    socket.connect();
    socket.emit('create_room', { playerName: playerName.trim(), targetScore });
  }

  function handleJoin() {
    if (!joinCode.trim()) { setError('Enter a room code.'); return; }
    socket.connect();
    socket.emit('join_room', { roomId: joinCode.trim().toUpperCase(), playerName: playerName.trim() });
  }

  const isHost = roomInfo?.hostId === myId;

  // Waiting in room lobby
  if (roomInfo) {
    return (
      <div className="lobby">
        <h1 className="lobby__title">ZAR</h1>
        <div className="lobby__room-code">
          Room Code: <strong>{roomInfo.roomId}</strong>
          <button className="btn btn--ghost" onClick={() => navigator.clipboard.writeText(roomInfo.roomId)}>Copy</button>
        </div>
        <p className="lobby__hint">Share this code with friends to join!</p>

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
              <input type="range" min={25} max={200} step={25} value={targetScore} onChange={e => setTargetScore(+e.target.value)} />
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
      </div>
    );
  }

  // Name entry
  if (step === 'name') {
    return (
      <div className="lobby lobby--centered">
        <h1 className="lobby__title">ZAR</h1>
        <p className="lobby__tagline">The addictive card game!</p>
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
        <button className="btn btn--primary" onClick={submitName}>Continue</button>
      </div>
    );
  }

  // Create or join
  return (
    <div className="lobby lobby--centered">
      <h1 className="lobby__title">ZAR</h1>
      <p className="lobby__player-name">Playing as: <strong>{playerName}</strong></p>
      {error && <p className="lobby__error">{error}</p>}

      <div className="lobby__actions">
        <div className="lobby__action-block">
          <h3>Create a Room</h3>
          <div className="lobby__score-setting">
            <label>Target score: <strong>{targetScore}</strong></label>
            <input type="range" min={25} max={200} step={25} value={targetScore} onChange={e => setTargetScore(+e.target.value)} />
          </div>
          <button className="btn btn--primary" onClick={handleCreate}>Create Room</button>
        </div>

        <div className="lobby__divider">OR</div>

        <div className="lobby__action-block">
          <h3>Join a Room</h3>
          <input
            className="lobby__input lobby__input--code"
            placeholder="Room code (e.g. ABC12)"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
            maxLength={5}
          />
          <button className="btn btn--secondary" onClick={handleJoin}>Join Room</button>
        </div>
      </div>
    </div>
  );
}
