import { useState } from 'react';
import type { Card as CardType, ClientGameState } from '../types';
import { socket } from '../socket';
import CardComponent from './Card';
import DragonModal from './DragonModal';
import PeacockModal from './PeacockModal';

function canPlayCard(card: CardType, state: ClientGameState): boolean {
  const top = state.topCard;
  if (!top) return true;

  if (state.pendingDrawCount > 0) {
    return card.kind === 'command' && card.command === 'wasp';
  }

  if (card.kind === 'power') {
    if (card.power === 'dragon') return top.kind !== 'power' || top.power === 'dragon';
    if (card.power === 'peacock') return top.kind !== 'power' || top.power === 'peacock';
  }

  // After dragon: declared symbol OR active color
  if (state.declaredSymbol) {
    if (card.kind === 'power' && card.power === 'dragon') return true;
    return card.symbol === state.declaredSymbol || card.color === state.activeColor;
  }

  // After peacock: declared color OR active symbol OR active command
  if (state.declaredColor) {
    if (card.kind === 'power' && card.power === 'peacock') return true;
    return card.color === state.declaredColor ||
           card.symbol === state.activeSymbol ||
           (card.command !== undefined && card.command === state.activeCommand);
  }

  // Normal play: active color, active symbol, or active command
  if (state.activeColor && card.color === state.activeColor) return true;
  if (state.activeSymbol && card.symbol === state.activeSymbol) return true;
  if (state.activeCommand && card.command === state.activeCommand) return true;
  return false;
}

function isMatchCard(card: CardType, top: CardType | null): boolean {
  if (!top) return false;
  if (card.kind === 'power' && top.kind === 'power') {
    return card.power === top.power && card.pair === top.pair;
  }
  if (card.kind !== 'power' && top.kind !== 'power') {
    if (card.color !== top.color) return false;
    if (card.symbol && top.symbol) return card.symbol === top.symbol;
    if (card.command && top.command) return card.command === top.command;
  }
  return false;
}

interface HandProps {
  hand: CardType[];
  state: ClientGameState;
  myId: string;
  isMyTurn: boolean;
}

export default function Hand({ hand, state, isMyTurn }: HandProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingCard, setPendingCard] = useState<CardType | null>(null);
  const [showDragon, setShowDragon] = useState(false);
  const [showPeacock, setShowPeacock] = useState(false);

  function handleCardClick(card: CardType) {
    if (state.phase !== 'playing') return;

    // Match window — out of turn match
    if (state.matchWindowOpen && !isMyTurn) {
      if (isMatchCard(card, state.topCard)) {
        socket.emit('match_card', { cardId: card.id });
        setSelectedId(null);
      }
      return;
    }

    if (!isMyTurn) return;

    // Double play selection
    if (selectedId && selectedId !== card.id) {
      const sel = hand.find(c => c.id === selectedId);
      if (sel && areDoubleMatch(sel, card)) {
        // Try to play as double
        playDouble(sel, card);
        setSelectedId(null);
        return;
      }
    }

    if (selectedId === card.id) {
      // Second click on same card — play it
      if (canPlayCard(card, state)) {
        playCard(card);
      }
      setSelectedId(null);
    } else {
      setSelectedId(card.id);
    }
  }

  function areDoubleMatch(a: CardType, b: CardType): boolean {
    if (a.kind === 'power' && b.kind === 'power') return a.power === b.power && a.pair === b.pair;
    if (a.kind !== 'power' && b.kind !== 'power') {
      if (a.color !== b.color) return false;
      if (a.symbol && b.symbol) return a.symbol === b.symbol;
      if (a.command && b.command) return a.command === b.command;
    }
    return false;
  }

  function playCard(card: CardType) {
    if (card.kind === 'power' && card.power === 'dragon') {
      setPendingCard(card);
      setShowDragon(true);
    } else if (card.kind === 'power' && card.power === 'peacock') {
      setPendingCard(card);
      setShowPeacock(true);
    } else {
      socket.emit('play_card', { cardId: card.id });
    }
    // Announce last card if this would leave 1 in hand
    if (hand.length === 2) {
      socket.emit('announce_last_card');
    }
  }

  function playDouble(c1: CardType, c2: CardType) {
    if (c2.kind === 'power' && c2.power === 'dragon') {
      setPendingCard(c2);
      setShowDragon(true);
      // TODO: handle double dragon declaration
    } else if (c2.kind === 'power' && c2.power === 'peacock') {
      setPendingCard(c2);
      setShowPeacock(true);
    } else {
      socket.emit('play_double', { cardId1: c1.id, cardId2: c2.id });
    }
  }

  return (
    <div className="hand">
      {hand.map(card => {
        const playable = isMyTurn ? canPlayCard(card, state) : (state.matchWindowOpen && isMatchCard(card, state.topCard));
        const isSelected = card.id === selectedId;
        return (
          <CardComponent
            key={card.id}
            card={card}
            onClick={() => handleCardClick(card)}
            selected={isSelected}
            playable={playable}
          />
        );
      })}

      {showDragon && pendingCard && (
        <DragonModal
          onSelect={symbol => {
            socket.emit('play_card', { cardId: pendingCard.id });
            // Server will wait for declare_symbol
            socket.emit('declare_symbol', { symbol });
            setShowDragon(false);
            setPendingCard(null);
          }}
          onClose={() => { setShowDragon(false); setPendingCard(null); }}
        />
      )}

      {showPeacock && pendingCard && (
        <PeacockModal
          onSelect={color => {
            socket.emit('play_card', { cardId: pendingCard.id });
            socket.emit('declare_color', { color });
            setShowPeacock(false);
            setPendingCard(null);
          }}
          onClose={() => { setShowPeacock(false); setPendingCard(null); }}
        />
      )}
    </div>
  );
}
