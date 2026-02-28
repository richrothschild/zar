import { describe, it, expect } from 'vitest';
import type { GameState, Card, Player } from '../server/types.js';
import { computeBotAction } from '../server/botLogic.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function basic(id: string, color: 'yellow' | 'blue' | 'red', symbol: 'star' | 'moon' | 'galaxy' | 'sun' | 'cloud' | 'lightning'): Card {
  return { id, kind: 'basic', color, symbol, points: 1 };
}

function command(id: string, color: 'yellow' | 'blue' | 'red', cmd: 'wasp' | 'frog' | 'crab'): Card {
  return { id, kind: 'command', color, command: cmd, points: cmd === 'wasp' ? 3 : 2 };
}

function power(id: string, pw: 'dragon' | 'peacock', pair: 1 | 2): Card {
  return { id, kind: 'power', power: pw, pair, points: 5 };
}

function player(id: string, hand: Card[] = [], score = 0, isBot = false): Player {
  return { id, name: id, hand, score, connected: true, announcedLastCard: false, isBot };
}

function makeState(botId: string, hand: Card[], overrides: Partial<GameState> = {}): GameState {
  const top = basic('top', 'yellow', 'star');
  return {
    phase: 'playing',
    players: [
      player(botId, hand, 0, true),
      player('p2', [basic('x', 'red', 'moon')]),
    ],
    drawPile: [basic('draw1', 'blue', 'galaxy')],
    playPile: [top],
    currentPlayerIndex: 0,
    direction: 'cw',
    pendingDrawCount: 0,
    skipsRemaining: 0,
    waitingForDeclaration: false,
    drawnThisTurn: false,
    dealerIndex: 0,
    targetScore: 50,
    matchWindowOpen: false,
    spectators: [],
    activeColor: 'yellow',
    activeSymbol: 'star',
    activeCommand: undefined,
    declaredSymbol: undefined,
    declaredColor: undefined,
    roundWinnerId: undefined,
    ...overrides,
  };
}

// ── computeBotAction ──────────────────────────────────────────────────────────

describe('computeBotAction', () => {
  it('returns pass for unknown bot id', () => {
    const s = makeState('bot', []);
    expect(computeBotAction(s, 'unknown')).toEqual({ type: 'pass' });
  });

  it('declares a symbol when waitingForDeclaration after dragon', () => {
    const dragonCard = power('d', 'dragon', 1);
    const s = makeState('bot', [], {
      waitingForDeclaration: true,
      playPile: [dragonCard],
    });
    const action = computeBotAction(s, 'bot');
    expect(action.type).toBe('declare_symbol');
    if (action.type === 'declare_symbol') {
      expect(['galaxy', 'moon', 'cloud', 'sun', 'star', 'lightning']).toContain(action.symbol);
    }
  });

  it('declares a color when waitingForDeclaration after peacock', () => {
    const peacockCard = power('p', 'peacock', 1);
    const s = makeState('bot', [], {
      waitingForDeclaration: true,
      playPile: [peacockCard],
    });
    const action = computeBotAction(s, 'bot');
    expect(action.type).toBe('declare_color');
    if (action.type === 'declare_color') {
      expect(['yellow', 'blue', 'red']).toContain(action.color);
    }
  });

  it('plays wasp to counter when pendingDrawCount > 0 and bot has wasp', () => {
    const wasp = command('w', 'yellow', 'wasp');
    const s = makeState('bot', [wasp], { pendingDrawCount: 2 });
    const action = computeBotAction(s, 'bot');
    expect(action).toEqual({ type: 'play_card', cardId: 'w' });
  });

  it('draws when pendingDrawCount > 0 and bot has no wasp', () => {
    const s = makeState('bot', [basic('b', 'yellow', 'star')], { pendingDrawCount: 2 });
    const action = computeBotAction(s, 'bot');
    expect(action.type).toBe('draw');
  });

  it('prefers a double over a single card when hand has 3+ cards', () => {
    const star1 = basic('s1', 'yellow', 'star');
    const star2 = basic('s2', 'yellow', 'star');
    const unrelated = basic('u', 'red', 'moon');
    // hand has 3 cards; first two form a double playable on yellow/star top
    const s = makeState('bot', [star1, star2, unrelated]);
    const action = computeBotAction(s, 'bot');
    expect(action.type).toBe('play_double');
  });

  it('does not attempt double when hand has exactly 2 cards', () => {
    // Rule: hand.length > 2 required for double preference
    const star1 = basic('s1', 'yellow', 'star');
    const star2 = basic('s2', 'yellow', 'star');
    const s = makeState('bot', [star1, star2]);
    const action = computeBotAction(s, 'bot');
    // Should play single instead of double
    expect(action.type).toBe('play_card');
  });

  it('plays first playable card when no double available', () => {
    const playable = basic('p', 'yellow', 'moon'); // matches yellow
    const s = makeState('bot', [playable]);
    const action = computeBotAction(s, 'bot');
    expect(action).toEqual({ type: 'play_card', cardId: 'p' });
  });

  it('draws when no playable card and has not drawn yet', () => {
    const s = makeState('bot', [basic('b', 'red', 'moon')], {
      activeColor: 'yellow',
      activeSymbol: 'star',
    });
    // red/moon card cannot play on yellow/star
    const action = computeBotAction(s, 'bot');
    expect(action.type).toBe('draw');
  });

  it('passes when already drew and still no playable card', () => {
    const s = makeState('bot', [basic('b', 'red', 'moon')], {
      activeColor: 'yellow',
      activeSymbol: 'star',
      drawnThisTurn: true,
    });
    const action = computeBotAction(s, 'bot');
    expect(action.type).toBe('pass');
  });

  it('passes when hand is empty and already drew', () => {
    const s = makeState('bot', [], { drawnThisTurn: true });
    const action = computeBotAction(s, 'bot');
    expect(action.type).toBe('pass');
  });
});
