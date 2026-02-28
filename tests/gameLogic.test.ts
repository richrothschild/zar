import { describe, it, expect } from 'vitest';
import type { GameState, Card, Player } from '../server/types.js';
import {
  canPlay, isMatch, isDouble,
  applyPlay, applyDouble,
  advanceTurn, drawCards, removeFromHand,
  applyDragonDeclaration, applyPeacockDeclaration,
  checkRoundOver,
} from '../server/gameLogic.js';

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

function player(id: string, hand: Card[] = [], score = 0): Player {
  return { id, name: id, hand, score, connected: true, announcedLastCard: false };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const top = basic('top', 'yellow', 'star');
  return {
    phase: 'playing',
    players: [player('p1'), player('p2')],
    drawPile: [],
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

// ── canPlay ───────────────────────────────────────────────────────────────────

describe('canPlay', () => {
  it('allows any card when the pile is empty', () => {
    const s = makeState({ playPile: [] });
    expect(canPlay(basic('c', 'red', 'moon'), s)).toBe(true);
  });

  it('allows card matching active color', () => {
    const s = makeState({ activeColor: 'yellow' });
    expect(canPlay(basic('c', 'yellow', 'moon'), s)).toBe(true);
  });

  it('allows card matching active symbol', () => {
    const s = makeState({ activeSymbol: 'star', activeColor: 'blue' });
    expect(canPlay(basic('c', 'red', 'star'), s)).toBe(true);
  });

  it('rejects card matching neither color nor symbol', () => {
    const s = makeState({ activeColor: 'yellow', activeSymbol: 'star', activeCommand: undefined });
    expect(canPlay(basic('c', 'red', 'moon'), s)).toBe(false);
  });

  it('only allows wasps when pendingDrawCount > 0', () => {
    const s = makeState({ pendingDrawCount: 2 });
    expect(canPlay(command('w', 'yellow', 'wasp'), s)).toBe(true);
    expect(canPlay(basic('b', 'yellow', 'star'), s)).toBe(false);
    expect(canPlay(command('f', 'yellow', 'frog'), s)).toBe(false);
    expect(canPlay(power('d', 'dragon', 1), s)).toBe(false);
  });

  it('allows command card matching active command', () => {
    const s = makeState({ activeColor: 'red', activeCommand: 'frog', activeSymbol: undefined });
    expect(canPlay(command('f', 'blue', 'frog'), s)).toBe(true);
  });

  it('dragon is playable on basic top', () => {
    const s = makeState({ playPile: [basic('top', 'yellow', 'star')] });
    expect(canPlay(power('d', 'dragon', 1), s)).toBe(true);
  });

  it('dragon is not playable on peacock top', () => {
    const s = makeState({ playPile: [power('top', 'peacock', 1)] });
    expect(canPlay(power('d', 'dragon', 1), s)).toBe(false);
  });

  it('peacock is playable on basic top', () => {
    const s = makeState({ playPile: [basic('top', 'yellow', 'star')] });
    expect(canPlay(power('p', 'peacock', 1), s)).toBe(true);
  });

  it('peacock is not playable on dragon top', () => {
    const s = makeState({ playPile: [power('top', 'dragon', 1)] });
    expect(canPlay(power('p', 'peacock', 1), s)).toBe(false);
  });

  it('after dragon declaration: allows matching declared symbol', () => {
    const s = makeState({ declaredSymbol: 'moon', activeColor: 'blue' });
    expect(canPlay(basic('c', 'red', 'moon'), s)).toBe(true);
  });

  it('after dragon declaration: allows matching active color', () => {
    const s = makeState({ declaredSymbol: 'moon', activeColor: 'blue' });
    expect(canPlay(basic('c', 'blue', 'sun'), s)).toBe(true);
  });

  it('after dragon declaration: rejects non-matching card', () => {
    const s = makeState({ declaredSymbol: 'moon', activeColor: 'blue' });
    expect(canPlay(basic('c', 'red', 'sun'), s)).toBe(false);
  });

  it('after peacock declaration: allows matching declared color', () => {
    const s = makeState({ declaredColor: 'red', activeSymbol: 'star' });
    expect(canPlay(basic('c', 'red', 'moon'), s)).toBe(true);
  });

  it('after peacock declaration: allows matching active symbol', () => {
    const s = makeState({ declaredColor: 'red', activeSymbol: 'star' });
    expect(canPlay(basic('c', 'blue', 'star'), s)).toBe(true);
  });

  it('after peacock declaration: rejects non-matching card', () => {
    const s = makeState({ declaredColor: 'red', activeSymbol: 'star' });
    expect(canPlay(basic('c', 'blue', 'moon'), s)).toBe(false);
  });
});

// ── isMatch / isDouble ────────────────────────────────────────────────────────

describe('isMatch', () => {
  it('matches two basic cards with same color and symbol', () => {
    expect(isMatch(basic('a', 'yellow', 'star'), basic('b', 'yellow', 'star'))).toBe(true);
  });

  it('rejects different symbol same color', () => {
    expect(isMatch(basic('a', 'yellow', 'star'), basic('b', 'yellow', 'moon'))).toBe(false);
  });

  it('rejects same symbol different color', () => {
    expect(isMatch(basic('a', 'yellow', 'star'), basic('b', 'blue', 'star'))).toBe(false);
  });

  it('matches two command cards with same color and command', () => {
    expect(isMatch(command('a', 'red', 'wasp'), command('b', 'red', 'wasp'))).toBe(true);
  });

  it('rejects command cards with different colors', () => {
    expect(isMatch(command('a', 'red', 'wasp'), command('b', 'blue', 'wasp'))).toBe(false);
  });

  it('rejects command cards with different commands', () => {
    expect(isMatch(command('a', 'red', 'wasp'), command('b', 'red', 'frog'))).toBe(false);
  });

  it('matches two power cards with same power and pair', () => {
    expect(isMatch(power('a', 'dragon', 1), power('b', 'dragon', 1))).toBe(true);
  });

  it('rejects power cards with same power but different pair', () => {
    expect(isMatch(power('a', 'dragon', 1), power('b', 'dragon', 2))).toBe(false);
  });

  it('rejects power cards with different power', () => {
    expect(isMatch(power('a', 'dragon', 1), power('b', 'peacock', 1))).toBe(false);
  });

  it('rejects basic vs command card', () => {
    expect(isMatch(basic('a', 'yellow', 'star'), command('b', 'yellow', 'wasp'))).toBe(false);
  });
});

describe('isDouble', () => {
  it('is equivalent to isMatch', () => {
    const a = basic('a', 'yellow', 'star');
    const b = basic('b', 'yellow', 'star');
    expect(isDouble(a, b)).toBe(isMatch(a, b));
  });
});

// ── applyPlay ─────────────────────────────────────────────────────────────────

describe('applyPlay', () => {
  it('basic card advances turn (0→1 with 2 players)', () => {
    const s = makeState();
    const card = basic('c', 'yellow', 'star');
    const next = applyPlay(s, 'p1', card);
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.drawnThisTurn).toBe(false);
  });

  it('wasp stacks pendingDrawCount by 2 and advances turn', () => {
    const s = makeState({ activeColor: 'yellow', activeCommand: 'wasp', activeSymbol: undefined });
    const card = command('w', 'yellow', 'wasp');
    const next = applyPlay(s, 'p1', card);
    expect(next.pendingDrawCount).toBe(2);
    expect(next.currentPlayerIndex).toBe(1);
  });

  it('wasp stacks on top of existing pendingDrawCount', () => {
    const s = makeState({
      pendingDrawCount: 2,
      activeColor: 'yellow',
      activeCommand: 'wasp',
      activeSymbol: undefined,
    });
    const card = command('w', 'yellow', 'wasp');
    const next = applyPlay(s, 'p1', card);
    expect(next.pendingDrawCount).toBe(4);
  });

  it('frog skips next player (advances 2 steps)', () => {
    const s = makeState({
      players: [player('p1'), player('p2'), player('p3')],
      currentPlayerIndex: 0,
      activeColor: 'yellow',
      activeCommand: 'frog',
      activeSymbol: undefined,
    });
    const card = command('f', 'yellow', 'frog');
    const next = applyPlay(s, 'p1', card);
    expect(next.currentPlayerIndex).toBe(2); // skipped p2
  });

  it('crab reverses direction and advances turn', () => {
    const s = makeState({ direction: 'cw', activeColor: 'yellow', activeCommand: 'crab', activeSymbol: undefined });
    const card = command('c', 'yellow', 'crab');
    const next = applyPlay(s, 'p1', card);
    expect(next.direction).toBe('ccw');
    expect(next.currentPlayerIndex).toBe(1); // still advances after reverse in 2-player
  });

  it('dragon sets waitingForDeclaration without advancing turn', () => {
    const s = makeState();
    const card = power('d', 'dragon', 1);
    const next = applyPlay(s, 'p1', card);
    expect(next.waitingForDeclaration).toBe(true);
    expect(next.currentPlayerIndex).toBe(0); // not advanced
  });

  it('peacock sets waitingForDeclaration without advancing turn', () => {
    const s = makeState();
    const card = power('p', 'peacock', 1);
    const next = applyPlay(s, 'p1', card);
    expect(next.waitingForDeclaration).toBe(true);
    expect(next.currentPlayerIndex).toBe(0);
  });

  it('updates topCard after play', () => {
    const s = makeState();
    const card = basic('new', 'blue', 'moon');
    const next = applyPlay(s, 'p1', card);
    expect(next.playPile[next.playPile.length - 1]).toEqual(card);
  });

  it('updates activeColor and activeSymbol for basic card', () => {
    const s = makeState();
    const card = basic('c', 'blue', 'moon');
    const next = applyPlay(s, 'p1', card);
    expect(next.activeColor).toBe('blue');
    expect(next.activeSymbol).toBe('moon');
    expect(next.activeCommand).toBeUndefined();
  });

  it('updates activeColor and activeCommand for command card', () => {
    const s = makeState();
    const card = command('w', 'red', 'wasp');
    const next = applyPlay(s, 'p1', card);
    expect(next.activeColor).toBe('red');
    expect(next.activeCommand).toBe('wasp');
    expect(next.activeSymbol).toBeUndefined();
  });
});

// ── applyDouble ───────────────────────────────────────────────────────────────

describe('applyDouble', () => {
  it('double wasp adds 4 to pendingDrawCount', () => {
    const s = makeState();
    const w1 = command('w1', 'yellow', 'wasp');
    const w2 = command('w2', 'yellow', 'wasp');
    const next = applyDouble(s, 'p1', w1, w2);
    expect(next.pendingDrawCount).toBe(4);
  });

  it('double wasp stacks on existing pendingDrawCount', () => {
    const s = makeState({ pendingDrawCount: 2 });
    const w1 = command('w1', 'yellow', 'wasp');
    const w2 = command('w2', 'yellow', 'wasp');
    const next = applyDouble(s, 'p1', w1, w2);
    expect(next.pendingDrawCount).toBe(6);
  });

  it('double frog skips 2 players (advances 3 steps)', () => {
    const s = makeState({
      players: [player('p1'), player('p2'), player('p3'), player('p4')],
      currentPlayerIndex: 0,
    });
    const f1 = command('f1', 'yellow', 'frog');
    const f2 = command('f2', 'yellow', 'frog');
    const next = applyDouble(s, 'p1', f1, f2);
    expect(next.currentPlayerIndex).toBe(3); // skipped p2 and p3
  });

  it('double crab cancels direction change', () => {
    const s = makeState({ direction: 'cw' });
    const c1 = command('c1', 'yellow', 'crab');
    const c2 = command('c2', 'yellow', 'crab');
    const next = applyDouble(s, 'p1', c1, c2);
    expect(next.direction).toBe('cw'); // unchanged
    expect(next.currentPlayerIndex).toBe(1); // still advances
  });

  it('double basic advances turn', () => {
    const s = makeState();
    const b1 = basic('b1', 'yellow', 'star');
    const b2 = basic('b2', 'yellow', 'star');
    const next = applyDouble(s, 'p1', b1, b2);
    expect(next.currentPlayerIndex).toBe(1);
  });
});

// ── advanceTurn ───────────────────────────────────────────────────────────────

describe('advanceTurn', () => {
  it('clockwise: 0→1 with 2 players', () => {
    const s = makeState({ direction: 'cw', currentPlayerIndex: 0 });
    expect(advanceTurn(s).currentPlayerIndex).toBe(1);
  });

  it('clockwise wraps: 1→0 with 2 players', () => {
    const s = makeState({ direction: 'cw', currentPlayerIndex: 1 });
    expect(advanceTurn(s).currentPlayerIndex).toBe(0);
  });

  it('counter-clockwise: 0→1 (wraps) with 2 players', () => {
    const s = makeState({ direction: 'ccw', currentPlayerIndex: 0 });
    expect(advanceTurn(s).currentPlayerIndex).toBe(1);
  });

  it('counter-clockwise: 1→0 with 2 players', () => {
    const s = makeState({ direction: 'ccw', currentPlayerIndex: 1 });
    expect(advanceTurn(s).currentPlayerIndex).toBe(0);
  });

  it('resets drawnThisTurn to false', () => {
    const s = makeState({ drawnThisTurn: true });
    expect(advanceTurn(s).drawnThisTurn).toBe(false);
  });

  it('advances multiple steps', () => {
    const s = makeState({
      players: [player('p1'), player('p2'), player('p3')],
      direction: 'cw',
      currentPlayerIndex: 0,
    });
    expect(advanceTurn(s, 2).currentPlayerIndex).toBe(2);
  });
});

// ── drawCards ─────────────────────────────────────────────────────────────────

describe('drawCards', () => {
  it('draws requested number of cards into player hand', () => {
    const cards = [basic('d1', 'red', 'moon'), basic('d2', 'blue', 'sun'), basic('d3', 'yellow', 'cloud')];
    const s = makeState({ drawPile: cards });
    const next = drawCards(s, 'p1', 2);
    expect(next.players.find(p => p.id === 'p1')!.hand).toHaveLength(2);
    expect(next.drawPile).toHaveLength(1);
  });

  it('stops gracefully when draw pile is empty', () => {
    const s = makeState({ drawPile: [] });
    const next = drawCards(s, 'p1', 3);
    expect(next.players.find(p => p.id === 'p1')!.hand).toHaveLength(0);
  });

  it('draws only available cards when pile is smaller than count', () => {
    const s = makeState({ drawPile: [basic('d1', 'red', 'moon')] });
    const next = drawCards(s, 'p1', 5);
    expect(next.players.find(p => p.id === 'p1')!.hand).toHaveLength(1);
  });
});

// ── removeFromHand ────────────────────────────────────────────────────────────

describe('removeFromHand', () => {
  it('removes the card from the player hand and returns it', () => {
    const card = basic('c', 'yellow', 'star');
    const s = makeState({ players: [player('p1', [card]), player('p2')] });
    const [next, removed] = removeFromHand(s, 'p1', 'c');
    expect(removed).toEqual(card);
    expect(next.players.find(p => p.id === 'p1')!.hand).toHaveLength(0);
  });

  it('returns null when card id not found', () => {
    const s = makeState();
    const [, removed] = removeFromHand(s, 'p1', 'nonexistent');
    expect(removed).toBeNull();
  });
});

// ── dragon/peacock declarations ───────────────────────────────────────────────

describe('applyDragonDeclaration', () => {
  it('sets declaredSymbol and clears waitingForDeclaration', () => {
    const s = makeState({ waitingForDeclaration: true });
    const next = applyDragonDeclaration(s, 'moon');
    expect(next.declaredSymbol).toBe('moon');
    expect(next.waitingForDeclaration).toBe(false);
  });

  it('advances turn after declaration', () => {
    const s = makeState({ waitingForDeclaration: true, currentPlayerIndex: 0 });
    const next = applyDragonDeclaration(s, 'moon');
    expect(next.currentPlayerIndex).toBe(1);
  });
});

describe('applyPeacockDeclaration', () => {
  it('sets declaredColor and clears waitingForDeclaration', () => {
    const s = makeState({ waitingForDeclaration: true });
    const next = applyPeacockDeclaration(s, 'red');
    expect(next.declaredColor).toBe('red');
    expect(next.waitingForDeclaration).toBe(false);
  });

  it('advances turn after declaration', () => {
    const s = makeState({ waitingForDeclaration: true, currentPlayerIndex: 0 });
    const next = applyPeacockDeclaration(s, 'red');
    expect(next.currentPlayerIndex).toBe(1);
  });
});

// ── checkRoundOver ────────────────────────────────────────────────────────────

describe('checkRoundOver', () => {
  it('returns unchanged state when no player has empty hand', () => {
    const s = makeState({
      players: [
        player('p1', [basic('c', 'yellow', 'star')]),
        player('p2', [basic('d', 'blue', 'moon')]),
      ],
    });
    const next = checkRoundOver(s);
    expect(next.phase).toBe('playing');
    expect(next.roundWinnerId).toBeUndefined();
  });

  it('detects round winner and scores remaining hands', () => {
    const loserCard = basic('c', 'yellow', 'star'); // 1 point
    const s = makeState({
      players: [
        player('p1', []), // winner — empty hand
        player('p2', [loserCard], 0),
      ],
      targetScore: 50,
    });
    const next = checkRoundOver(s);
    expect(next.roundWinnerId).toBe('p1');
    expect(next.players.find(p => p.id === 'p1')!.score).toBe(0);  // winner gets nothing
    expect(next.players.find(p => p.id === 'p2')!.score).toBe(1);  // 1 card × 1pt
  });

  it('sets phase to round_over when loser score < targetScore', () => {
    const s = makeState({
      players: [
        player('p1', []),
        player('p2', [basic('c', 'yellow', 'star')], 0),
      ],
      targetScore: 50,
    });
    expect(checkRoundOver(s).phase).toBe('round_over');
  });

  it('sets phase to game_over when loser reaches targetScore', () => {
    const loserCards = Array.from({ length: 10 }, (_, i) =>
      command(`c${i}`, 'yellow', 'wasp') // 3 pts each → 30 pts
    );
    const s = makeState({
      players: [
        player('p1', []),
        player('p2', loserCards, 30), // 30 existing + 30 new = 60 >= targetScore 50
      ],
      targetScore: 50,
    });
    expect(checkRoundOver(s).phase).toBe('game_over');
  });

  it('adds points to loser cumulative score', () => {
    const s = makeState({
      players: [
        player('p1', []),
        player('p2', [command('w', 'yellow', 'wasp')], 10), // 10 existing + 3 new
      ],
      targetScore: 100,
    });
    const next = checkRoundOver(s);
    expect(next.players.find(p => p.id === 'p2')!.score).toBe(13);
  });
});
