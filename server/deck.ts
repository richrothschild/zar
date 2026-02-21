import { Card, CardColor, CardSymbol, CommandKind, PowerKind } from './types.js';

const COLORS: CardColor[] = ['yellow', 'blue', 'red'];
const SYMBOLS: CardSymbol[] = ['galaxy', 'moon', 'cloud', 'sun', 'star', 'lightning'];
const COMMANDS: CommandKind[] = ['wasp', 'frog', 'crab'];

let _idCounter = 0;
function uid() { return String(++_idCounter); }

export function buildDeck(): Card[] {
  _idCounter = 0;
  const cards: Card[] = [];

  // 36 Basic Symbol Cards: 6 symbols × 3 colors × 2 copies
  for (const symbol of SYMBOLS) {
    for (const color of COLORS) {
      for (let i = 0; i < 2; i++) {
        cards.push({ id: uid(), kind: 'basic', color, symbol, points: 5 });
      }
    }
  }

  // 18 Command Cards: 3 types × 3 colors × 2 copies
  for (const command of COMMANDS) {
    for (const color of COLORS) {
      for (let i = 0; i < 2; i++) {
        cards.push({ id: uid(), kind: 'command', color, command, points: 15 });
      }
    }
  }

  // 8 Power Cards: Dragon ×4 (2 pairs), Peacock ×4 (2 pairs)
  for (const power of ['dragon', 'peacock'] as PowerKind[]) {
    for (const pair of [1, 2] as const) {
      for (let i = 0; i < 2; i++) {
        cards.push({ id: uid(), kind: 'power', power, pair, points: 25 });
      }
    }
  }

  return shuffle(cards);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function calcHandScore(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + c.points, 0);
}
