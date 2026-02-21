import { Card, CardColor, CardSymbol, GameState, Player } from './types.js';
import { buildDeck, calcHandScore, shuffle } from './deck.js';

// ── Playability ────────────────────────────────────────────────────────────────

export function canPlay(card: Card, state: GameState): boolean {
  const top = state.playPile[state.playPile.length - 1];
  if (!top) return true;

  // If there are pending wasp draws, only another wasp (or nothing) can save you
  if (state.pendingDrawCount > 0) {
    return card.kind === 'command' && card.command === 'wasp';
  }

  // Power cards
  if (card.kind === 'power') {
    if (card.power === 'dragon') return top.kind !== 'power' || top.power === 'dragon';
    if (card.power === 'peacock') return top.kind !== 'power' || top.power === 'peacock';
  }

  // After dragon, must match declared symbol (or another dragon)
  if (state.declaredSymbol && !state.declaredColor) {
    if (card.kind === 'power' && card.power === 'dragon') return true;
    return card.symbol === state.declaredSymbol;
  }

  // After peacock, must match declared color (or another peacock)
  if (state.declaredColor && !state.declaredSymbol) {
    if (card.kind === 'power' && card.power === 'peacock') return true;
    return card.color === state.declaredColor;
  }

  // Normal play: same color or same symbol
  if (card.color && top.color && card.color === top.color) return true;
  if (card.symbol && top.symbol && card.symbol === top.symbol) return true;
  if (card.command && top.command && card.command === top.command) return true;
  // command vs basic — match by color
  if (card.color && top.color && card.color === top.color) return true;

  return false;
}

/** A "match" requires exact same symbol AND color (basic/command cards only).
 *  For power cards, exact pair match (same power + same pair index). */
export function isMatch(a: Card, b: Card): boolean {
  if (a.kind === 'power' && b.kind === 'power') {
    return a.power === b.power && a.pair === b.pair;
  }
  if (a.kind !== 'power' && b.kind !== 'power') {
    // Both must share color and same "identity" (symbol or command type)
    if (a.color !== b.color) return false;
    if (a.symbol && b.symbol) return a.symbol === b.symbol;
    if (a.command && b.command) return a.command === b.command;
  }
  return false;
}

export function isDouble(card1: Card, card2: Card): boolean {
  return isMatch(card1, card2);
}

// ── Game Setup ─────────────────────────────────────────────────────────────────

export function startRound(state: GameState): GameState {
  const deck = buildDeck();
  const numPlayers = state.players.length;
  const handSize = Math.max(3, Math.min(7, 10 - numPlayers));

  const players = state.players.map(p => ({ ...p, hand: [] as Card[], announcedLastCard: false }));

  let idx = 0;
  for (let i = 0; i < handSize; i++) {
    for (const p of players) {
      p.hand.push(deck[idx++]);
    }
  }

  // Find first non-power card for the play pile
  let topIdx = idx;
  while (topIdx < deck.length && deck[topIdx].kind === 'power') topIdx++;
  if (topIdx === deck.length) topIdx = idx; // fallback (shouldn't happen)

  const playPile = [deck[topIdx]];
  const drawPile = [
    ...deck.slice(idx, topIdx),
    ...deck.slice(topIdx + 1),
  ];

  return {
    ...state,
    phase: 'playing',
    players,
    drawPile,
    playPile,
    currentPlayerIndex: 0,
    direction: 'cw',
    pendingDrawCount: 0,
    skipsRemaining: 0,
    declaredSymbol: undefined,
    declaredColor: undefined,
    waitingForDeclaration: false,
    roundWinnerId: undefined,
    matchWindowOpen: false,
  };
}

// ── Turn Actions ───────────────────────────────────────────────────────────────

/** Draw `count` cards from the draw pile into a player's hand. Reshuffles if needed. */
export function drawCards(state: GameState, playerId: string, count: number): GameState {
  let s = { ...state, players: state.players.map(p => ({ ...p, hand: [...p.hand] })) };
  const player = s.players.find(p => p.id === playerId);
  if (!player) return s;

  let drawPile = [...s.drawPile];

  for (let i = 0; i < count; i++) {
    if (drawPile.length === 0) {
      // Reshuffle play pile (keep top card)
      const top = s.playPile[s.playPile.length - 1];
      drawPile = shuffle(s.playPile.slice(0, -1));
      s = { ...s, playPile: [top] };
    }
    if (drawPile.length === 0) break; // truly empty
    player.hand.push(drawPile.shift()!);
  }

  return { ...s, drawPile };
}

/** Remove a card from a player's hand by id. Returns [newState, card]. */
export function removeFromHand(state: GameState, playerId: string, cardId: string): [GameState, Card | null] {
  const players = state.players.map(p => {
    if (p.id !== playerId) return p;
    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return p;
    const hand = [...p.hand];
    hand.splice(idx, 1);
    return { ...p, hand };
  });
  const card = state.players.find(p => p.id === playerId)?.hand.find(c => c.id === cardId) ?? null;
  return [{ ...state, players }, card];
}

/** Place a card on the play pile and clear declared state. */
function placeCard(state: GameState, card: Card): GameState {
  return {
    ...state,
    playPile: [...state.playPile, card],
    declaredSymbol: undefined,
    declaredColor: undefined,
  };
}

/** Advance turn index by `steps` in current direction, wrapping around active players. */
export function advanceTurn(state: GameState, steps = 1): GameState {
  const n = state.players.length;
  let idx = state.currentPlayerIndex;
  for (let i = 0; i < steps; i++) {
    idx = state.direction === 'cw'
      ? (idx + 1) % n
      : (idx - 1 + n) % n;
  }
  return { ...state, currentPlayerIndex: idx };
}

/** Apply a single card play (not double, not match). Returns new state. */
export function applyPlay(state: GameState, playerId: string, card: Card): GameState {
  let s = placeCard(state, card);

  if (card.kind === 'basic') {
    s = advanceTurn(s);
    return s;
  }

  if (card.kind === 'command') {
    if (card.command === 'wasp') {
      s = { ...s, pendingDrawCount: s.pendingDrawCount + 2 };
      s = advanceTurn(s);
    } else if (card.command === 'frog') {
      // Skip next player
      s = advanceTurn(s, 2); // skip one, land on player after
    } else if (card.command === 'crab') {
      s = { ...s, direction: s.direction === 'cw' ? 'ccw' : 'cw' };
      s = advanceTurn(s);
    }
    return s;
  }

  if (card.kind === 'power') {
    // Dragon and Peacock require a declaration before advancing
    s = { ...s, waitingForDeclaration: true };
    return s;
  }

  return advanceTurn(s);
}

/** Apply a double play (matching pair played as one). */
export function applyDouble(state: GameState, playerId: string, card1: Card, card2: Card): GameState {
  // Place both; only card2 is the "active" top
  let s = placeCard(state, card1);
  s = placeCard(s, card2);

  if (card2.kind === 'command') {
    if (card2.command === 'wasp') {
      s = { ...s, pendingDrawCount: s.pendingDrawCount + 4 };
      s = advanceTurn(s);
    } else if (card2.command === 'frog') {
      // Double frog skips 2 players
      s = advanceTurn(s, 3); // skip two, land on player after
    } else if (card2.command === 'crab') {
      // Double crab cancels — direction unchanged
      s = advanceTurn(s);
    }
  } else if (card2.kind === 'power') {
    s = { ...s, waitingForDeclaration: true };
  } else {
    s = advanceTurn(s);
  }

  return s;
}

/** After dragon declaration. */
export function applyDragonDeclaration(state: GameState, symbol: CardSymbol): GameState {
  return advanceTurn({
    ...state,
    declaredSymbol: symbol,
    declaredColor: undefined,
    waitingForDeclaration: false,
  });
}

/** After peacock declaration. */
export function applyPeacockDeclaration(state: GameState, color: CardColor): GameState {
  return advanceTurn({
    ...state,
    declaredColor: color,
    declaredSymbol: undefined,
    waitingForDeclaration: false,
  });
}

// ── Round End ──────────────────────────────────────────────────────────────────

export function checkRoundOver(state: GameState): GameState {
  const winner = state.players.find(p => p.hand.length === 0);
  if (!winner) return state;

  // Score remaining hands against losers
  const players = state.players.map(p => ({
    ...p,
    score: p.score + (p.id === winner.id ? 0 : calcHandScore(p.hand)),
  }));

  const gameOver = players.some(p => p.score >= state.targetScore);

  return {
    ...state,
    players,
    phase: gameOver ? 'game_over' : 'round_over',
    roundWinnerId: winner.id,
  };
}

// ── View Builder ───────────────────────────────────────────────────────────────

import { ClientGameState, ClientPlayer } from './types.js';

export function buildClientState(state: GameState, requestingPlayerId: string): ClientGameState {
  return {
    phase: state.phase,
    players: state.players.map((p): ClientPlayer => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      hand: p.id === requestingPlayerId ? p.hand : undefined,
      score: p.score,
      connected: p.connected,
      announcedLastCard: p.announcedLastCard,
    })),
    drawPileCount: state.drawPile.length,
    topCard: state.playPile[state.playPile.length - 1] ?? null,
    currentPlayerIndex: state.currentPlayerIndex,
    direction: state.direction,
    pendingDrawCount: state.pendingDrawCount,
    skipsRemaining: state.skipsRemaining,
    declaredSymbol: state.declaredSymbol,
    declaredColor: state.declaredColor,
    waitingForDeclaration: state.waitingForDeclaration,
    targetScore: state.targetScore,
    roundWinnerId: state.roundWinnerId,
    matchWindowOpen: state.matchWindowOpen,
  };
}
