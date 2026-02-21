// Re-export server types for frontend use
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
  pair?: 1 | 2;
  points: number;
}

export type Direction = 'cw' | 'ccw';
export type GamePhase = 'lobby' | 'playing' | 'round_over' | 'game_over';

export interface ClientPlayer {
  id: string;
  name: string;
  handCount: number;
  hand?: Card[];
  score: number;
  connected: boolean;
  announcedLastCard: boolean;
}

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

export interface RoomInfo {
  roomId: string;
  hostId: string;
  players: { id: string; name: string; connected: boolean }[];
  phase: GamePhase;
}
