import { useEffect, useState } from 'react';
import { socket } from './socket';
import type { ClientGameState, RoomInfo } from './types';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import './App.css';

export default function App() {
  const [myId, setMyId] = useState('');
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [hostId, setHostId] = useState('');
  const [notification, setNotification] = useState('');

  useEffect(() => {
    socket.on('connect', () => setMyId(socket.id ?? ''));

    socket.on('room_update', (info: RoomInfo) => {
      setRoomInfo(info);
      setHostId(info.hostId);
    });

    socket.on('game_state', (state: ClientGameState) => {
      setGameState(state);
    });

    socket.on('error', ({ message }: { message: string }) => {
      showNotification(`⚠️ ${message}`);
    });

    socket.on('last_card_announced', ({ playerName }: { playerName: string }) => {
      showNotification(`📢 ${playerName} says ZAR!`);
    });

    socket.on('last_card_challenge', ({ challengerName, targetName }: { challengerName: string; targetName: string }) => {
      showNotification(`🚨 ${challengerName} challenged ${targetName}! Draw 1 card.`);
    });

    return () => { socket.removeAllListeners(); };
  }, []);

  function showNotification(msg: string) {
    setNotification(msg);
    setTimeout(() => setNotification(''), 4000);
  }

  const inGame = gameState && gameState.phase !== 'lobby';

  return (
    <div className="app">
      {notification && <div className="notification">{notification}</div>}
      {inGame ? (
        <GameBoard state={gameState} myId={myId} hostId={hostId} />
      ) : (
        <Lobby roomInfo={roomInfo} myId={myId} onStartGame={() => socket.emit('start_game')} />
      )}
    </div>
  );
}
