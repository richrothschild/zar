import { useEffect, useRef, useState } from 'react';
import { socket } from './socket';
import type { ClientGameState, RoomInfo } from './types';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import { playYourTurn, playZar, playChallenge, playRoundWin, playKicked } from './sound';
import './App.css';

interface SuggestBotsPayload { currentCount: number; botsNeeded: number; }

function BotDialog({ payload, onConfirm }: { payload: SuggestBotsPayload; onConfirm: (confirm: boolean) => void }) {
  return (
    <div className="modal-overlay">
      <div className="modal bot-dialog">
        <h2 className="modal__title">Add Bot Players?</h2>
        <p className="modal__body">
          You have {payload.currentCount} player{payload.currentCount !== 1 ? 's' : ''}.
          Add {payload.botsNeeded} bot{payload.botsNeeded !== 1 ? 's' : ''} to fill to 4?
        </p>
        <div className="modal__actions">
          <button className="btn btn--draw" onClick={() => onConfirm(true)}>
            Yes, add {payload.botsNeeded} bot{payload.botsNeeded !== 1 ? 's' : ''}
          </button>
          <button className="btn btn--ghost" onClick={() => onConfirm(false)}>
            No, start with {payload.currentCount}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [myId, setMyId] = useState('');
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [hostId, setHostId] = useState('');
  const [notification, setNotification] = useState('');
  const [isSpectator, setIsSpectator] = useState(false);
  const [suggestBots, setSuggestBots] = useState<SuggestBotsPayload | null>(null);
  const prevTurnPlayerId = useRef<string | null>(null);
  const myIdRef = useRef('');
  myIdRef.current = myId;

  useEffect(() => {
    socket.on('connect', () => setMyId(socket.id ?? ''));

    socket.on('room_update', (info: RoomInfo) => {
      setRoomInfo(info);
      setHostId(info.hostId);
    });

    socket.on('game_state', (state: ClientGameState) => {
      // Detect when it becomes my turn and play a sound
      const currentPlayerId = state.players[state.currentPlayerIndex]?.id ?? null;
      if (
        state.phase === 'playing' &&
        currentPlayerId === myIdRef.current &&
        prevTurnPlayerId.current !== myIdRef.current
      ) {
        playYourTurn();
      }
      if (state.phase === 'round_over' || state.phase === 'game_over') {
        playRoundWin();
      }
      prevTurnPlayerId.current = currentPlayerId;
      setGameState(state);
      setIsSpectator(state.isSpectator);
    });

    socket.on('suggest_bots', (payload: SuggestBotsPayload) => {
      setSuggestBots(payload);
    });

    socket.on('error', ({ message }: { message: string }) => {
      showNotification(`⚠️ ${message}`);
    });

    socket.on('last_card_announced', ({ playerName }: { playerName: string }) => {
      playZar();
      showNotification(`📢 ${playerName} says ZAR!`);
    });

    socket.on('last_card_challenge', ({ challengerName, targetName }: { challengerName: string; targetName: string }) => {
      playChallenge();
      showNotification(`🚨 ${challengerName} challenged ${targetName}! Draw 1 card.`);
    });

    socket.on('kicked', ({ message }: { message: string }) => {
      playKicked();
      showNotification(`🚫 ${message}`);
      setGameState(null);
      setRoomInfo(null);
      socket.disconnect();
    });

    socket.on('server_restart', ({ message }: { message: string }) => {
      showNotification(`🔄 ${message}`);
    });

    return () => { socket.removeAllListeners(); };
  }, []);

  function showNotification(msg: string) {
    setNotification(msg);
    setTimeout(() => setNotification(''), 4000);
  }

  function handleBotConfirm(confirm: boolean) {
    socket.emit('confirm_bots', { confirm });
    setSuggestBots(null);
  }

  const inGame = gameState && gameState.phase !== 'lobby';

  return (
    <div className="app">
      {notification && <div className="notification">{notification}</div>}
      {suggestBots && <BotDialog payload={suggestBots} onConfirm={handleBotConfirm} />}
      {inGame ? (
        <GameBoard state={gameState} myId={myId} hostId={hostId} isSpectator={isSpectator} />
      ) : (
        <Lobby roomInfo={roomInfo} myId={myId} onStartGame={() => socket.emit('start_game')} />
      )}
    </div>
  );
}
