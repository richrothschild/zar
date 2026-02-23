import type { ClientGameState, ClientPlayer } from '../types';
import { socket } from '../socket';

interface PlayerListProps {
  state: ClientGameState;
  myId: string;
}

export default function PlayerList({ state, myId }: PlayerListProps) {
  const currentPlayer = state.players[state.currentPlayerIndex];

  return (
    <div className="player-list">
      <div className="player-list__direction">
        Direction: {state.direction === 'cw' ? '↻ Clockwise' : '↺ Counter-CW'}
      </div>
      {state.players.map((p) => (
        <PlayerRow
          key={p.id}
          player={p}
          isMe={p.id === myId}
          isCurrent={p.id === currentPlayer?.id}
          state={state}
        />
      ))}
    </div>
  );
}

function PlayerRow({ player, isMe, isCurrent, state }: {
  player: ClientPlayer;
  isMe: boolean;
  isCurrent: boolean;
  state: ClientGameState;
}) {
  const canChallenge = !isMe &&
    player.handCount === 1 &&
    !player.announcedLastCard &&
    state.phase === 'playing';

  return (
    <div className={`player-row${isCurrent ? ' player-row--current' : ''}${isMe ? ' player-row--me' : ''}${!player.connected ? ' player-row--disconnected' : ''}`}>
      <div className="player-row__indicator">{isCurrent ? '▶' : ' '}</div>
      <div className="player-row__info">
        <span className="player-row__name">{player.name}{isMe ? ' (you)' : ''}</span>
        {!player.connected && <span className="player-row__tag player-row__tag--dc">disconnected</span>}
        {player.announcedLastCard && <span className="player-row__tag player-row__tag--last">ZAR!</span>}
      </div>
      <div className="player-row__stats">
        <span className="player-row__cards">🃏 {player.handCount}</span>
        <span className="player-row__score">{player.score} pts</span>
      </div>
      {canChallenge && (
        <button
          className="player-row__challenge"
          onClick={() => socket.emit('challenge_last_card', { targetPlayerId: player.id })}
          title="Challenge — they didn't say 'last card'!"
        >
          Challenge!
        </button>
      )}
    </div>
  );
}
