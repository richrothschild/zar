import type { ClientGameState } from '../types';
import { socket } from '../socket';
import CardComponent from './Card';
import Hand from './Hand';
import PlayerList from './PlayerList';
import DragonModal from './DragonModal';
import PeacockModal from './PeacockModal';
import { SYMBOL_EMOJI } from './Card';

interface GameBoardProps {
  state: ClientGameState;
  myId: string;
  hostId: string;
}

export default function GameBoard({ state, myId, hostId }: GameBoardProps) {
  const me = state.players.find(p => p.id === myId);
  const isMyTurn = state.players[state.currentPlayerIndex]?.id === myId;
  const isHost = myId === hostId;

  const currentPlayer = state.players[state.currentPlayerIndex];

  function handleDraw() {
    socket.emit('draw_card');
  }

  function handlePass() {
    socket.emit('pass');
  }

  if (state.phase === 'round_over' || state.phase === 'game_over') {
    return <ScoreScreen state={state} myId={myId} isHost={isHost} />;
  }

  const declaredLabel = state.declaredSymbol
    ? `${SYMBOL_EMOJI[state.declaredSymbol]} ${state.declaredSymbol}`
    : state.declaredColor
    ? `${state.declaredColor.toUpperCase()}`
    : null;

  return (
    <div className="board">
      {/* Left sidebar — player list */}
      <aside className="board__sidebar">
        <PlayerList state={state} myId={myId} />
        {state.matchWindowOpen && (
          <div className="board__match-banner">
            ⚡ Match window open! Play a matching card!
          </div>
        )}
      </aside>

      {/* Center — play area */}
      <main className="board__center">
        <div className="board__status">
          {isMyTurn
            ? <span className="board__your-turn">Your turn!</span>
            : <span>Waiting for <strong>{currentPlayer?.name}</strong>…</span>
          }
          {state.pendingDrawCount > 0 && (
            <span className="board__wasp-warning"> 🐝 Draw {state.pendingDrawCount} (or play a Wasp)</span>
          )}
          {declaredLabel && (
            <span className="board__declared"> Active: {declaredLabel}</span>
          )}
        </div>

        <div className="board__piles">
          {/* Draw pile */}
          <div className="board__draw-pile" onClick={isMyTurn && !state.waitingForDeclaration ? handleDraw : undefined} title="Draw a card">
            <CardComponent card={{ id: 'back', kind: 'basic', points: 0 }} faceDown />
            <span className="board__pile-count">{state.drawPileCount}</span>
          </div>

          {/* Top card */}
          <div className="board__play-pile">
            {state.topCard
              ? <CardComponent card={state.topCard} />
              : <div className="board__empty-pile">Play pile</div>
            }
          </div>
        </div>

        {/* Action buttons */}
        {isMyTurn && !state.waitingForDeclaration && (
          <div className="board__actions">
            <button className="btn btn--draw" onClick={handleDraw}>
              {state.pendingDrawCount > 0 ? `Draw ${state.pendingDrawCount} 🐝` : 'Draw 1'}
            </button>
            {state.pendingDrawCount === 0 && (
              <button className="btn btn--pass" onClick={handlePass}>Pass</button>
            )}
          </div>
        )}

        {/* Dragon declaration modal — when server is waiting */}
        {state.waitingForDeclaration && isMyTurn && state.topCard?.power === 'dragon' && (
          <DragonModal
            onSelect={symbol => socket.emit('declare_symbol', { symbol })}
            onClose={() => {}}
          />
        )}
        {state.waitingForDeclaration && isMyTurn && state.topCard?.power === 'peacock' && (
          <PeacockModal
            onSelect={color => socket.emit('declare_color', { color })}
            onClose={() => {}}
          />
        )}
      </main>

      {/* Bottom — my hand */}
      <footer className="board__hand-area">
        <div className="board__hand-label">
          Your hand ({me?.hand?.length ?? 0} cards)
          {me?.hand?.length === 1 && !me.announcedLastCard && (
            <button className="btn btn--last-card" onClick={() => socket.emit('announce_last_card')}>
              Say "Last Card!"
            </button>
          )}
        </div>
        {me?.hand && (
          <Hand hand={me.hand} state={state} myId={myId} isMyTurn={isMyTurn} />
        )}
      </footer>
    </div>
  );
}

function ScoreScreen({ state, myId, isHost }: { state: ClientGameState; myId: string; isHost: boolean }) {
  const winner = state.players.find(p => p.id === state.roundWinnerId);
  const gameOver = state.phase === 'game_over';
  const sortedPlayers = [...state.players].sort((a, b) => a.score - b.score);

  return (
    <div className="score-screen">
      <h2>{gameOver ? '🏆 Game Over!' : '🎉 Round Over!'}</h2>
      {winner && <p className="score-screen__winner">{winner.name} went out!</p>}

      <div className="score-screen__table">
        {sortedPlayers.map((p, i) => (
          <div key={p.id} className={`score-row${p.id === myId ? ' score-row--me' : ''}`}>
            <span className="score-row__rank">#{i + 1}</span>
            <span className="score-row__name">{p.name}</span>
            <span className="score-row__score">{p.score} / {state.targetScore} pts</span>
          </div>
        ))}
      </div>

      {!gameOver && isHost && (
        <button className="btn btn--primary" onClick={() => socket.emit('next_round')}>
          Next Round
        </button>
      )}
      {!gameOver && !isHost && (
        <p>Waiting for host to start the next round…</p>
      )}
      {gameOver && (
        <p className="score-screen__final">Thanks for playing ZAR!</p>
      )}
    </div>
  );
}
