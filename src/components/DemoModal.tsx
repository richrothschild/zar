import { useState, useEffect, useRef } from 'react';
import type { Card as CardType, CardColor, CardSymbol } from '../types';
import CardComponent from './Card';

// ── Deck builder (self-contained for demo) ───────────────────
let _demoId = 0;
function uid() { return `d${++_demoId}`; }

function buildDemoDeck(): CardType[] {
  _demoId = 0;
  const COLORS: CardColor[] = ['yellow', 'blue', 'red'];
  const SYMBOLS: CardSymbol[] = ['galaxy', 'moon', 'cloud', 'sun', 'star', 'lightning'];
  const cards: CardType[] = [];

  for (const symbol of SYMBOLS)
    for (const color of COLORS)
      for (let i = 0; i < 2; i++)
        cards.push({ id: uid(), kind: 'basic', color, symbol, points: 1 });

  for (const command of ['wasp', 'frog', 'crab'] as const)
    for (const color of COLORS)
      for (let i = 0; i < 2; i++)
        cards.push({ id: uid(), kind: 'command', color, command, points: command === 'wasp' ? 3 : 2 });

  for (const power of ['dragon', 'peacock'] as const)
    for (const pair of [1, 2] as const)
      for (let i = 0; i < 2; i++)
        cards.push({ id: uid(), kind: 'power', power, pair, points: 5 });

  // Fisher–Yates shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// ── Demo state ───────────────────────────────────────────────
interface DemoState {
  players: { name: string; hand: CardType[] }[];
  drawPile: CardType[];
  discardPile: CardType[];
  currentPlayer: number;
  direction: 'cw' | 'ccw';
  pendingDraw: number;
  declaredSymbol?: string;
  declaredColor?: string;
  log: string;
}

function cardLabel(c: CardType): string {
  if (c.kind === 'basic') return `${c.symbol} (${c.color})`;
  if (c.kind === 'command') return c.command!.toUpperCase();
  return c.power!.toUpperCase();
}

function canPlayDemo(card: CardType, top: CardType, pendingDraw: number, declaredSymbol?: string, declaredColor?: string): boolean {
  if (pendingDraw > 0) return card.kind === 'command' && card.command === 'wasp';
  if (card.kind === 'power') {
    if (card.power === 'dragon') return top.kind !== 'power' || top.power === 'dragon';
    if (card.power === 'peacock') return top.kind !== 'power' || top.power === 'peacock';
  }
  if (declaredSymbol) {
    if (card.kind === 'power' && card.power === 'dragon') return true;
    return card.symbol === declaredSymbol || card.color === top.color;
  }
  if (declaredColor) {
    if (card.kind === 'power' && card.power === 'peacock') return true;
    return card.color === declaredColor || card.symbol === top.symbol || card.command === top.command;
  }
  if (top.color && card.color === top.color) return true;
  if (top.symbol && card.symbol === top.symbol) return true;
  if (top.command && card.command === top.command) return true;
  return false;
}

function nextIdx(current: number, n: number, dir: 'cw' | 'ccw', skip = false): number {
  const step = dir === 'cw' ? 1 : -1;
  let next = (current + step + n) % n;
  if (skip) next = (next + step + n) % n;
  return next;
}

const RAND_SYMBOLS: CardSymbol[] = ['galaxy', 'moon', 'cloud', 'sun', 'star', 'lightning'];
const RAND_COLORS: CardColor[] = ['yellow', 'blue', 'red'];
function randOf<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function stepSimulation(state: DemoState): DemoState {
  const n = state.players.length;
  const ci = state.currentPlayer;
  const player = state.players[ci];
  const name = player.name;
  const top = state.discardPile[state.discardPile.length - 1];

  // Must draw from wasp stack
  if (state.pendingDraw > 0) {
    const wasp = player.hand.find(c => c.kind === 'command' && c.command === 'wasp');
    if (wasp) {
      const newPending = state.pendingDraw + 2;
      const newHand = player.hand.filter(c => c.id !== wasp.id);
      const newPlayers = state.players.map((p, i) => i === ci ? { ...p, hand: newHand } : p);
      return { ...state, players: newPlayers, discardPile: [...state.discardPile, wasp],
        currentPlayer: nextIdx(ci, n, state.direction), pendingDraw: newPending,
        declaredSymbol: undefined, declaredColor: undefined,
        log: `${name} counters with Wasp! Stack is now ${newPending}.` };
    }
    const count = Math.min(state.pendingDraw, state.drawPile.length);
    const drawn = state.drawPile.slice(0, count);
    const newPlayers = state.players.map((p, i) => i === ci ? { ...p, hand: [...p.hand, ...drawn] } : p);
    return { ...state, players: newPlayers, drawPile: state.drawPile.slice(count),
      currentPlayer: nextIdx(ci, n, state.direction), pendingDraw: 0,
      log: `${name} draws ${count} card${count !== 1 ? 's' : ''} (Wasp penalty).` };
  }

  // Find first playable card
  const playIdx = player.hand.findIndex(c =>
    canPlayDemo(c, top, state.pendingDraw, state.declaredSymbol, state.declaredColor));

  if (playIdx >= 0) {
    const card = player.hand[playIdx];
    const newHand = player.hand.filter((_, i) => i !== playIdx);
    const newPlayers = state.players.map((p, i) => i === ci ? { ...p, hand: newHand } : p);
    const newDiscard = [...state.discardPile, card];

    if (card.kind === 'command') {
      if (card.command === 'wasp') {
        return { ...state, players: newPlayers, discardPile: newDiscard,
          currentPlayer: nextIdx(ci, n, state.direction), pendingDraw: 2,
          declaredSymbol: undefined, declaredColor: undefined,
          log: `${name} plays Wasp! Next player draws 2 (or counters with Wasp).` };
      }
      if (card.command === 'frog') {
        return { ...state, players: newPlayers, discardPile: newDiscard,
          currentPlayer: nextIdx(ci, n, state.direction, true),
          declaredSymbol: undefined, declaredColor: undefined,
          log: `${name} plays Frog! Skips the next player.` };
      }
      if (card.command === 'crab') {
        const newDir = state.direction === 'cw' ? 'ccw' : 'cw';
        return { ...state, players: newPlayers, discardPile: newDiscard, direction: newDir,
          currentPlayer: nextIdx(ci, n, newDir),
          declaredSymbol: undefined, declaredColor: undefined,
          log: `${name} plays Crab! Direction reverses.` };
      }
    }

    if (card.kind === 'power') {
      if (card.power === 'dragon') {
        const sym = randOf(RAND_SYMBOLS);
        return { ...state, players: newPlayers, discardPile: newDiscard,
          currentPlayer: nextIdx(ci, n, state.direction), declaredSymbol: sym, declaredColor: undefined,
          log: `${name} plays Dragon! Declares symbol: ${sym}.` };
      }
      if (card.power === 'peacock') {
        const col = randOf(RAND_COLORS);
        return { ...state, players: newPlayers, discardPile: newDiscard,
          currentPlayer: nextIdx(ci, n, state.direction), declaredColor: col, declaredSymbol: undefined,
          log: `${name} plays Peacock! Declares color: ${col}.` };
      }
    }

    // Basic card
    return { ...state, players: newPlayers, discardPile: newDiscard,
      currentPlayer: nextIdx(ci, n, state.direction),
      declaredSymbol: undefined, declaredColor: undefined,
      log: `${name} plays ${cardLabel(card)}.` };
  }

  // Draw one card
  if (state.drawPile.length > 0) {
    const drawn = state.drawPile[0];
    const newPlayers = state.players.map((p, i) => i === ci ? { ...p, hand: [...p.hand, drawn] } : p);
    // Try the drawn card immediately
    if (canPlayDemo(drawn, top, 0, state.declaredSymbol, state.declaredColor)) {
      const newHand = newPlayers[ci].hand.filter(c => c.id !== drawn.id);
      const finalPlayers = newPlayers.map((p, i) => i === ci ? { ...p, hand: newHand } : p);
      return { ...state, players: finalPlayers, drawPile: state.drawPile.slice(1),
        discardPile: [...state.discardPile, drawn],
        currentPlayer: nextIdx(ci, n, state.direction),
        declaredSymbol: undefined, declaredColor: undefined,
        log: `${name} draws and immediately plays ${cardLabel(drawn)}.` };
    }
    return { ...state, players: newPlayers, drawPile: state.drawPile.slice(1),
      currentPlayer: nextIdx(ci, n, state.direction),
      log: `${name} has no playable card — draws 1 and passes.` };
  }

  return { ...state, currentPlayer: nextIdx(ci, n, state.direction),
    log: `${name} passes (draw pile empty).` };
}

function initDemo(): DemoState {
  const deck = buildDemoDeck();
  const names = ['Alice', 'Bob', 'Carlos', 'Diana'];
  const players = names.map((name, i) => ({ name, hand: deck.slice(i * 5, i * 5 + 5) }));
  const rest = deck.slice(20);
  const top = rest[0];
  return {
    players, drawPile: rest.slice(1), discardPile: [top],
    currentPlayer: 0, direction: 'cw', pendingDraw: 0,
    log: `Game starts! Top card: ${cardLabel(top)}. Alice goes first.`,
  };
}

// ── Component ────────────────────────────────────────────────
interface DemoModalProps {
  onClose: () => void;
}

const MAX_STEPS = 10;

export default function DemoModal({ onClose }: DemoModalProps) {
  const [state, setState] = useState<DemoState>(initDemo);
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const done = step >= MAX_STEPS;

  useEffect(() => {
    if (!running || done) return;
    timerRef.current = setTimeout(() => {
      setState(prev => stepSimulation(prev));
      setStep(s => s + 1);
    }, 1500);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [running, step, done]);

  function handleReset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(initDemo());
    setStep(0);
    setRunning(false);
  }

  const top = state.discardPile[state.discardPile.length - 1] ?? null;

  return (
    <div className="demo-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="demo-modal">

        {/* Header */}
        <div className="demo-header">
          <h2 className="demo-title">Simulated Game</h2>
          <button className="btn btn--ghost" onClick={onClose}>← Back</button>
        </div>

        {/* Log */}
        <div className="demo-log-bar">
          <span className="demo-log">{state.log}</span>
          <span className="demo-counter">Move {step} / {MAX_STEPS}</span>
        </div>

        {/* Top player — Bob (index 1) */}
        <div className="demo-player demo-player--top">
          <div className={`demo-player__name${state.currentPlayer === 1 ? ' demo-player__name--active' : ''}`}>
            {state.currentPlayer === 1 && <span className="demo-arrow">▶</span>}
            {state.players[1].name} · {state.players[1].hand.length} cards
          </div>
          <div className="demo-hand">
            {state.players[1].hand.map(c => <CardComponent key={c.id} card={c} small />)}
          </div>
        </div>

        {/* Middle row */}
        <div className="demo-middle">

          {/* Left player — Diana (index 3) */}
          <div className="demo-player demo-player--side">
            <div className={`demo-player__name${state.currentPlayer === 3 ? ' demo-player__name--active' : ''}`}>
              {state.currentPlayer === 3 && <span className="demo-arrow">▶</span>}
              {state.players[3].name}
            </div>
            <div className="demo-hand demo-hand--wrap">
              {state.players[3].hand.map(c => <CardComponent key={c.id} card={c} small />)}
            </div>
            <div className="demo-side-count">{state.players[3].hand.length} cards</div>
          </div>

          {/* Center piles */}
          <div className="demo-center">
            <div className="demo-pile">
              <div className="demo-pile__label">Draw Pile</div>
              {state.drawPile.length > 0
                ? <CardComponent card={state.drawPile[0]} faceDown />
                : <div className="demo-pile__empty">Empty</div>}
              <div className="demo-pile__count">{state.drawPile.length} cards</div>
            </div>
            <div className="demo-pile">
              <div className="demo-pile__label">Discard</div>
              {top && <CardComponent card={top} />}
              {state.declaredSymbol && (
                <div className="demo-declared">Symbol: {state.declaredSymbol}</div>
              )}
              {state.declaredColor && (
                <div className="demo-declared">Color: {state.declaredColor}</div>
              )}
              <div className="demo-pile__count">{state.discardPile.length} played</div>
            </div>
          </div>

          {/* Right player — Carlos (index 2) */}
          <div className="demo-player demo-player--side">
            <div className={`demo-player__name${state.currentPlayer === 2 ? ' demo-player__name--active' : ''}`}>
              {state.currentPlayer === 2 && <span className="demo-arrow">▶</span>}
              {state.players[2].name}
            </div>
            <div className="demo-hand demo-hand--wrap">
              {state.players[2].hand.map(c => <CardComponent key={c.id} card={c} small />)}
            </div>
            <div className="demo-side-count">{state.players[2].hand.length} cards</div>
          </div>
        </div>

        {/* Bottom player — Alice (index 0) */}
        <div className="demo-player demo-player--bottom">
          <div className="demo-hand">
            {state.players[0].hand.map(c => <CardComponent key={c.id} card={c} small />)}
          </div>
          <div className={`demo-player__name${state.currentPlayer === 0 ? ' demo-player__name--active' : ''}`}>
            {state.currentPlayer === 0 && <span className="demo-arrow">▶</span>}
            {state.players[0].name} · {state.players[0].hand.length} cards
          </div>
        </div>

        {/* Controls */}
        <div className="demo-controls">
          {!running && !done && (
            <button className="btn btn--primary" onClick={() => setRunning(true)}>▶ Play Simulation</button>
          )}
          {running && !done && (
            <button className="btn btn--pass" onClick={() => setRunning(false)}>⏸ Pause</button>
          )}
          {done && <span className="demo-done">Simulation complete!</span>}
          <button className="btn btn--secondary" onClick={handleReset}>↺ New Game</button>
          <button className="btn btn--ghost" onClick={onClose}>← Back to Sign In</button>
        </div>
      </div>
    </div>
  );
}
