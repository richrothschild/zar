export type CardColor = 'yellow' | 'blue' | 'red';
export type CardSymbol = 'galaxy' | 'moon' | 'cloud' | 'sun' | 'star' | 'lightning';
export type CommandKind = 'wasp' | 'frog' | 'crab';
export type PowerKind = 'dragon' | 'peacock';
export type CardKind = 'basic' | 'command' | 'power';

export interface Card {
  id: string;
  kind: CardKind;
  color?: CardColor;
  symbol?: CardSymbol;
  command?: CommandKind;
  power?: PowerKind;
  pair?: 1 | 2; // which pair (for power cards, only exact pair matches)
  points: number;
}

export interface Player {
  id: string;       // socket id
  name: string;
  hand: Card[];
  score: number;
  connected: boolean;
  announcedLastCard: boolean;
}

export type Direction = 'cw' | 'ccw';
export type GamePhase = 'lobby' | 'playing' | 'round_over' | 'game_over';

export interface GameState {
  phase: GamePhase;
  players: Player[];
  drawPile: Card[];
  playPile: Card[];
  currentPlayerIndex: number;
  direction: Direction;
  pendingDrawCount: number;   // stacked wasp draws
  skipsRemaining: number;     // stacked frog skips
  declaredSymbol?: CardSymbol; // after dragon played
  declaredColor?: CardColor;   // after peacock played
  waitingForDeclaration: boolean; // dragon/peacock waiting for choice
  targetScore: number;
  roundWinnerId?: string;
  matchWindowOpen: boolean;   // brief window for out-of-turn matches
}

// What the client receives — hand is hidden for other players
export interface ClientGameState {
  phase: GamePhase;
  players: ClientPlayer[];
  drawPileCount: number;
  topCard: Card | null;
  currentPlayerIndex: number;
  direction: Direction;
  pendingDrawCount: number;
  skipsRemaining: number;
  declaredSymbol?: CardSymbol;
  declaredColor?: CardColor;
  waitingForDeclaration: boolean;
  targetScore: number;
  roundWinnerId?: string;
  matchWindowOpen: boolean;
}

export interface ClientPlayer {
  id: string;
  name: string;
  handCount: number;
  hand?: Card[]; // only populated for the requesting player
  score: number;
  connected: boolean;
  announcedLastCard: boolean;
}

export interface Room {
  id: string;
  hostId: string;
  state: GameState;
}

// Socket event payloads
export interface JoinRoomPayload { roomId: string; playerName: string; }
export interface CreateRoomPayload { playerName: string; targetScore: number; }
export interface PlayCardPayload { cardId: string; }
export interface PlayDoublePayload { cardId1: string; cardId2: string; }
export interface DeclareSymbolPayload { symbol: CardSymbol; }
export interface DeclareColorPayload { color: CardColor; }
export interface MatchCardPayload { cardId: string; }
export interface ChallengLastCardPayload { targetPlayerId: string; }
