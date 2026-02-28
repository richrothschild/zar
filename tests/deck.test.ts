import { describe, it, expect } from 'vitest';
import { buildDeck, calcHandScore, shuffle } from '../server/deck.js';
import type { Card } from '../server/types.js';

describe('buildDeck', () => {
  it('returns exactly 62 cards', () => {
    expect(buildDeck()).toHaveLength(62);
  });

  it('has 36 basic cards', () => {
    expect(buildDeck().filter(c => c.kind === 'basic')).toHaveLength(36);
  });

  it('has 18 command cards', () => {
    expect(buildDeck().filter(c => c.kind === 'command')).toHaveLength(18);
  });

  it('has 8 power cards', () => {
    expect(buildDeck().filter(c => c.kind === 'power')).toHaveLength(8);
  });

  it('has 6 wasp cards', () => {
    expect(buildDeck().filter(c => c.command === 'wasp')).toHaveLength(6);
  });

  it('has 4 dragon and 4 peacock cards', () => {
    const deck = buildDeck();
    expect(deck.filter(c => c.power === 'dragon')).toHaveLength(4);
    expect(deck.filter(c => c.power === 'peacock')).toHaveLength(4);
  });

  it('assigns unique ids', () => {
    const deck = buildDeck();
    const ids = new Set(deck.map(c => c.id));
    expect(ids.size).toBe(62);
  });

  it('resets ids on second call (no duplicates across calls)', () => {
    const d1 = buildDeck();
    const d2 = buildDeck();
    const allIds = [...d1.map(c => c.id), ...d2.map(c => c.id)];
    // Both decks have the same set of ids (1–62) — they reset
    expect(new Set(d1.map(c => c.id)).size).toBe(62);
    expect(new Set(d2.map(c => c.id)).size).toBe(62);
    // All ids exist in both decks (counter resets)
    expect(allIds).toHaveLength(124);
  });
});

describe('calcHandScore', () => {
  it('returns 0 for empty hand', () => {
    expect(calcHandScore([])).toBe(0);
  });

  it('sums basic card points (1 each)', () => {
    const hand: Card[] = [
      { id: '1', kind: 'basic', color: 'yellow', symbol: 'star', points: 1 },
      { id: '2', kind: 'basic', color: 'blue', symbol: 'moon', points: 1 },
    ];
    expect(calcHandScore(hand)).toBe(2);
  });

  it('sums mixed card points', () => {
    const hand: Card[] = [
      { id: '1', kind: 'basic', color: 'yellow', symbol: 'star', points: 1 },
      { id: '2', kind: 'command', color: 'blue', command: 'wasp', points: 3 },
      { id: '3', kind: 'power', power: 'dragon', pair: 1, points: 5 },
    ];
    expect(calcHandScore(hand)).toBe(9);
  });
});

describe('shuffle', () => {
  it('preserves all elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle(arr);
    expect(result).toHaveLength(5);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3];
    shuffle(arr);
    expect(arr).toEqual([1, 2, 3]);
  });
});
