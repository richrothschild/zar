import { useState } from 'react';
import type { ClientGameState, ClientPlayer } from '../types';
import { socket } from '../socket';
import CardComponent, { SYMBOL_EMOJI, COLOR_HEX } from './Card';
import Hand from './Hand';
import PlayerList from './PlayerList';
import DragonModal from './DragonModal';
import PeacockModal from './PeacockModal';
import VoiceChat from './VoiceChat';
import HelpModal from './HelpModal';

interface GameBoardProps {
  state: ClientGameState;
  myId: string;
  hostId: string;
  isSpectator: boolean;
}

export default function GameBoard({ state, myId, hostId, isSpectator }: GameBoardProps) {
  const [showHelp, setShowHelp] = useState(false);
  const me = state.players.find(p => p.id === myId);
  const isMyTurn = !isSpectator && state.players[state.currentPlayerIndex]?.id === myId;
  const isHost = myId === hostId;
  const currentPlayer = state.players[state.currentPlayerIndex];

  function handleDraw() { socket.emit('draw_card'); }
  function handlePass() { socket.emit('pass'); }

  if (state.phase === 'round_over' || state.phase === 'game_over') {
    return <ScoreScreen state={state} myId={myId} isHost={isHost} />;
  }

  // Active state label (symbol / color declared after dragon/peacock)
  let activeDisplay: React.ReactNode = null;
  if (state.declaredSymbol) {
    activeDisplay = (
      <span className="board__declared">
        {SYMBOL_EMOJI[state.declaredSymbol]} {state.declaredSymbol}
        {state.activeColor && (
          <> &nbsp;<span className="color-dot" style={{ background: COLOR_HEX[state.activeColor] }} /></>
        )}
      </span>
    );
  } else if (state.declaredColor) {
    activeDisplay = (
      <span className="board__declared">
        <span className="color-dot" style={{ background: COLOR_HEX[state.declaredColor] }} />
        {state.activeSymbol && <> {SYMBOL_EMOJI[state.activeSymbol]}</>}
        {!state.activeSymbol && state.activeCommand && <> {state.activeCommand.toUpperCase()}</>}
      </span>
    );
  } else if (state.activeColor || state.activeSymbol || state.activeCommand) {
    activeDisplay = (
      <span className="board__declared">
        {state.activeColor && <span className="color-dot" style={{ background: COLOR_HEX[state.activeColor] }} />}
        {state.activeSymbol && <> {SYMBOL_EMOJI[state.activeSymbol]}</>}
        {!state.activeSymbol && state.activeCommand && <> {state.activeCommand.toUpperCase()}</>}
      </span>
    );
  }

  const zarPlayers = state.players.filter(p => p.handCount === 1);

  const canDraw = isMyTurn && !state.waitingForDeclaration &&
    (state.pendingDrawCount > 0 || !state.drawnThisTurn);
  const drawLabel = state.pendingDrawCount > 0 ? `Draw ${state.pendingDrawCount} 🐝` : 'Draw 1';

  return (
    <div className="board">
      {showHelp && <HelpModal initialTab="rules" onClose={() => setShowHelp(false)} />}

      {/* ── Status bar ── */}
      <div className="board__status">
        {isSpectator
          ? <span className="board__spectator-label">👁 Watching</span>
          : isMyTurn
            ? <span className="board__your-turn">Your turn!</span>
            : <span>Waiting for <strong>{currentPlayer?.name}</strong>…</span>
        }
        {state.pendingDrawCount > 0 && (
          <span className="board__wasp-warning">🐝 Draw {state.pendingDrawCount} or play Wasp</span>
        )}
        {activeDisplay}
      </div>

      {/* ── Player chips bar ── */}
      <div className="board__player-bar">
        <PlayerList state={state} myId={myId} />
      </div>

      {/* ── Match window banner — time-critical, very prominent ── */}
      {state.matchWindowOpen && (
        <div className="board__match-banner">
          ⚡ Match window open — play a matching card now!
        </div>
      )}

      {/* ── ZAR alert ── */}
      {zarPlayers.length > 0 && (
        <div className="board__zar-list">
          {zarPlayers.map(p => (
            <span key={p.id} className="board__zar-item">{p.name} — ZAR!</span>
          ))}
        </div>
      )}

      {/* ── Play area: direction + piles ── */}
      <div className="board__play-area">
        <div className="board__direction">
          {state.direction === 'cw' ? '↻ Clockwise' : '↺ Counter-CW'}
        </div>
        <div className="board__piles">
          {/* Draw pile */}
          <div className="board__pile-wrapper">
            <div className="board__pile-label">Draw</div>
            <div
              className="board__draw-pile"
              onClick={canDraw ? handleDraw : undefined}
              title={canDraw ? drawLabel : 'Draw pile'}
              style={{ opacity: canDraw ? 1 : 0.6, cursor: canDraw ? 'pointer' : 'default' }}
            >
              <CardComponent card={{ id: 'back', kind: 'basic', points: 0 }} faceDown />
              <span className="board__pile-count">{state.drawPileCount}</span>
            </div>
          </div>

          {/* Discard pile */}
          <div className="board__pile-wrapper">
            <div className="board__pile-label">Discard</div>
            <div className="board__play-pile">
              {state.topCard
                ? <CardComponent card={state.topCard} />
                : <div className="board__empty-pile">Empty</div>
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Action buttons ── */}
      {isMyTurn && !state.waitingForDeclaration && (
        <div className="board__actions">
          <button
            className="btn btn--draw"
            onClick={handleDraw}
            disabled={!canDraw}
          >
            {drawLabel}
          </button>
          {state.pendingDrawCount === 0 && (
            <button className="btn btn--pass" onClick={handlePass}>Pass</button>
          )}
        </div>
      )}

      {/* Dragon declaration modal */}
      {state.waitingForDeclaration && isMyTurn && state.topCard?.power === 'dragon' && (
        <DragonModal
          onSelect={symbol => socket.emit('declare_symbol', { symbol })}
          onClose={() => {}}
        />
      )}
      {/* Peacock declaration modal */}
      {state.waitingForDeclaration && isMyTurn && state.topCard?.power === 'peacock' && (
        <PeacockModal
          onSelect={color => socket.emit('declare_color', { color })}
          onClose={() => {}}
        />
      )}

      {/* ── Secondary bar: voice + help ── */}
      <div className="board__secondary-bar">
        <VoiceChat players={state.players} spectators={state.spectators} myId={myId} />
        <button className="btn btn--ghost board__rules-btn" onClick={() => setShowHelp(true)}>
          Rules &amp; Tips
        </button>
      </div>

      {/* ── Hand (sticky at bottom) ── */}
      {!isSpectator && (
        <footer className="board__hand-area">
          <div className="board__hand-label">
            Your hand ({me?.hand?.length ?? 0})
            {me?.hand?.length === 1 && !me.announcedLastCard && (
              <button className="btn btn--last-card" onClick={() => socket.emit('announce_last_card')}>
                Say ZAR!
              </button>
            )}
          </div>
          {me?.hand && (
            <Hand hand={me.hand} state={state} myId={myId} isMyTurn={isMyTurn} />
          )}
        </footer>
      )}
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
        {sortedPlayers.map((p: ClientPlayer, i: number) => (
          <div key={p.id} className={`score-row${p.id === myId ? ' score-row--me' : ''}`}>
            <div className="score-row__main">
              <span className="score-row__rank">#{i + 1}</span>
              <span className="score-row__name">{p.name}</span>
              <span className="score-row__score">{p.score} / {state.targetScore} pts</span>
            </div>
            {p.hand && p.hand.length > 0 && (
              <div className="score-row__cards">
                {p.hand.map(c => <CardComponent key={c.id} card={c} small />)}
              </div>
            )}
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
