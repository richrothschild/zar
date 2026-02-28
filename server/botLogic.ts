import type { GameState, CardSymbol, CardColor } from './types.js';
import { canPlay, isDouble } from './gameLogic.js';

export type BotAction =
  | { type: 'declare_symbol'; symbol: CardSymbol }
  | { type: 'declare_color'; color: CardColor }
  | { type: 'play_card'; cardId: string }
  | { type: 'play_double'; cardId1: string; cardId2: string }
  | { type: 'draw' }
  | { type: 'pass' };

const SYMBOLS: CardSymbol[] = ['galaxy', 'moon', 'cloud', 'sun', 'star', 'lightning'];
const COLORS: CardColor[] = ['yellow', 'blue', 'red'];

function randItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function computeBotAction(state: GameState, botId: string): BotAction {
  const bot = state.players.find(p => p.id === botId);
  if (!bot) return { type: 'pass' };

  // Waiting for dragon/peacock declaration the bot just triggered
  if (state.waitingForDeclaration) {
    const top = state.playPile[state.playPile.length - 1];
    if (top?.power === 'dragon') {
      return { type: 'declare_symbol', symbol: randItem(SYMBOLS) };
    }
    return { type: 'declare_color', color: randItem(COLORS) };
  }

  // Must draw or counter with a wasp
  if (state.pendingDrawCount > 0) {
    const wasp = bot.hand.find(c => c.kind === 'command' && c.command === 'wasp');
    if (wasp) return { type: 'play_card', cardId: wasp.id };
    return { type: 'draw' };
  }

  // Prefer doubles (reduces hand faster) when more than 2 cards remain
  if (bot.hand.length > 2) {
    for (let i = 0; i < bot.hand.length; i++) {
      for (let j = i + 1; j < bot.hand.length; j++) {
        const c1 = bot.hand[i], c2 = bot.hand[j];
        if (isDouble(c1, c2) && canPlay(c1, state)) {
          return { type: 'play_double', cardId1: c1.id, cardId2: c2.id };
        }
      }
    }
  }

  // Play first playable card
  const playable = bot.hand.find(c => canPlay(c, state));
  if (playable) return { type: 'play_card', cardId: playable.id };

  // Nothing to play — draw once, then pass if already drew
  if (state.drawnThisTurn) return { type: 'pass' };
  return { type: 'draw' };
}
