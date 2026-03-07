import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Redis } from 'ioredis';
import * as Sentry from '@sentry/node';
import type { Room, GameState, CardSymbol, CardColor } from './types.js';
import {
  startRound, drawCards, removeFromHand, applyPlay, applyDouble,
  applyDragonDeclaration, applyPeacockDeclaration,
  checkRoundOver, buildClientState, canPlay, isMatch, isDouble,
  advanceTurnSkippingInactive,
} from './gameLogic.js';
import { computeBotAction } from './botLogic.js';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'production' });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const ALLOWED_ORIGIN_RAW = process.env.ALLOWED_ORIGIN ?? (process.env.NODE_ENV === 'production' ? false : '*');
const ALLOWED_ORIGIN = typeof ALLOWED_ORIGIN_RAW === 'string' && ALLOWED_ORIGIN_RAW.includes(',')
  ? ALLOWED_ORIGIN_RAW.split(',').map(s => s.trim())
  : ALLOWED_ORIGIN_RAW;

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
if (redis) {
  redis.on('error', (err: Error) => console.error('[redis] connection error:', err));
  console.log('[redis] connected');
} else {
  console.log('[redis] no REDIS_URL — using in-memory store only');
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGIN as string | string[] | false, methods: ['GET', 'POST'] },
});

// Health check (before static, so it always responds)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: Math.floor(process.uptime()) });
});

// Serve built frontend in production
const distPath = join(__dirname, '../dist');
app.use(express.static(distPath));
app.use((_req, res) => res.sendFile(join(distPath, 'index.html')));

// ── In-memory store ────────────────────────────────────────────────────────────
const rooms = new Map<string, Room>();

// ── Voice chat participants ─────────────────────────────────────────────────────
const voiceRooms = new Map<string, Set<string>>(); // roomId → Set<socketId>

// ── Stall detection ─────────────────────────────────────────────────────────────
const lastMoveAt = new Map<string, number>();
const roomWatchdogs = new Map<string, ReturnType<typeof setInterval>>();
const pendingBotTimers = new Set<string>();

// ── Room cleanup ────────────────────────────────────────────────────────────────
const roomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ROOM_CLEANUP_MS = 10 * 60 * 1000; // 10 minutes after game_over / empty lobby

function scheduleRoomCleanup(roomId: string) {
  if (roomCleanupTimers.has(roomId)) return; // already scheduled
  const id = setTimeout(() => {
    rooms.delete(roomId);
    lastMoveAt.delete(roomId);
    roomCleanupTimers.delete(roomId);
    stopWatchdog(roomId);
    if (redis) void redis.del(`room:${roomId}`);
    console.log(`[cleanup] Room ${roomId} deleted`);
  }, ROOM_CLEANUP_MS);
  roomCleanupTimers.set(roomId, id);
}

function cancelRoomCleanup(roomId: string) {
  const id = roomCleanupTimers.get(roomId);
  if (id !== undefined) { clearTimeout(id); roomCleanupTimers.delete(roomId); }
}

// ── Redis persistence ───────────────────────────────────────────────────────────
function roomToJSON(room: Room): string {
  return JSON.stringify(room, (key, value: unknown) => {
    if (key === 'reconnectTimer') return undefined; // non-serialisable handle
    return value;
  });
}

async function persistRoom(roomId: string): Promise<void> {
  if (!redis) return;
  const room = rooms.get(roomId);
  if (!room) { await redis.del(`room:${roomId}`); return; }
  await redis.set(`room:${roomId}`, roomToJSON(room), 'EX', 86400); // 24 h TTL
}

// ── Reconnect timer (extracted so Redis restore can reuse it) ───────────────────
function startReconnectTimer(roomId: string, playerId: string, delayMs: number) {
  const room = rooms.get(roomId);
  if (!room) return;
  const player = room.state.players.find(p => p.id === playerId);
  if (!player) return;
  const timer = setTimeout(() => {
    const r = rooms.get(roomId);
    if (!r) return;
    const removedIdx = r.state.players.findIndex(p => p.id === playerId);
    if (removedIdx === -1) return; // already reconnected or removed
    const newPlayers = r.state.players.filter(p => p.id !== playerId);
    let newCurrentIdx = r.state.currentPlayerIndex;
    if (removedIdx < newCurrentIdx) newCurrentIdx -= 1;
    else if (removedIdx === newCurrentIdx) newCurrentIdx = newCurrentIdx % Math.max(1, newPlayers.length);
    r.state = { ...r.state, players: newPlayers, currentPlayerIndex: newCurrentIdx };
    if (r.hostId === playerId) {
      const newHost = newPlayers.find(p => !p.isBot && p.connected)
        ?? newPlayers.find(p => !p.isBot)
        ?? newPlayers[0];
      if (newHost) r.hostId = newHost.id;
    }
    const activePlayers = newPlayers.filter(p => p.connected || p.isBot);
    if (activePlayers.length < 2 && r.state.phase === 'playing') {
      r.state = { ...r.state, phase: 'game_over' };
    }
    broadcastRoomInfo(roomId);
    broadcastState(roomId);
    scheduleBotTurnIfNeeded(roomId);
  }, delayMs);
  player.reconnectTimer = timer;
}

async function loadRoomsFromRedis(): Promise<void> {
  if (!redis) return;
  const keys = await redis.keys('room:*');
  console.log(`[redis] restoring ${keys.length} room(s)…`);
  for (const key of keys) {
    const data = await redis.get(key);
    if (!data) continue;
    try {
      const room = JSON.parse(data) as Room;
      if (room.state.phase === 'lobby') continue; // lobby rooms not worth restoring
      // Remove players whose reconnect window already expired
      room.state = {
        ...room.state,
        players: room.state.players.filter(p => {
          if (p.connected || p.isBot) return true;
          return Date.now() - (p.disconnectedAt ?? 0) < RECONNECT_MS;
        }),
      };
      rooms.set(room.id, room);
      // Re-arm reconnect timers for still-valid disconnected players
      for (const p of room.state.players) {
        if (!p.connected && !p.isBot) {
          const elapsed = Date.now() - (p.disconnectedAt ?? 0);
          startReconnectTimer(room.id, p.id, Math.max(1000, RECONNECT_MS - elapsed));
        }
      }
      touchRoom(room.id);
      startWatchdog(room.id);
      scheduleBotTurnIfNeeded(room.id);
      console.log(`[redis] restored room ${room.id} (phase: ${room.state.phase})`);
    } catch (err) {
      console.error(`[redis] failed to restore ${key}:`, err);
    }
  }
}

// ── Constants ──────────────────────────────────────────────────────────────────
const SYMBOLS: CardSymbol[] = ['galaxy', 'moon', 'cloud', 'sun', 'star', 'lightning'];
const COLORS: CardColor[] = ['yellow', 'blue', 'red'];
const RECONNECT_MS = 90_000;
const BOT_NAMES = ['Keemo', 'Janice'];

function randItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function removeFromVoice(socketId: string) {
  for (const [roomId, participants] of voiceRooms.entries()) {
    if (participants.has(socketId)) {
      participants.delete(socketId);
      for (const peerId of participants) {
        io.to(peerId).emit('voice_peer_left', { peerId: socketId });
      }
      if (participants.size === 0) voiceRooms.delete(roomId);
      break;
    }
  }
}

function genRoomId(): string {
  let id: string;
  do { id = Math.random().toString(36).substring(2, 7).toUpperCase(); } while (rooms.has(id));
  return id;
}

// ── Broadcast helpers ──────────────────────────────────────────────────────────
function broadcastState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  // Send personalized state to each connected human player
  for (const player of room.state.players) {
    if (player.isBot || !player.connected) continue;
    io.to(player.id).emit('game_state', buildClientState(room.state, player.id));
  }
  // Send public state (no hands) to spectators
  for (const spec of room.state.spectators) {
    io.to(spec.id).emit('game_state', { ...buildClientState(room.state, 'spectator'), isSpectator: true });
  }
  // Schedule deletion once the game is fully over
  if (room.state.phase === 'game_over') {
    scheduleRoomCleanup(roomId);
  }
  void persistRoom(roomId);
}

function broadcastRoomInfo(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  void persistRoom(roomId);
  io.to(roomId).emit('room_update', {
    roomId,
    hostId: room.hostId,
    players: room.state.players.map(p => ({ id: p.id, name: p.name, connected: p.connected, isBot: p.isBot })),
    spectators: room.state.spectators.map(s => ({ id: s.id, name: s.name })),
    phase: room.state.phase,
  });
}

// ── Match window ───────────────────────────────────────────────────────────────
// The match window opens when a card is placed and closes when the next card is
// placed on the discard pile. There is no time limit — players can match at any
// point until someone plays next.

function openMatchWindow(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.state = { ...room.state, matchWindowOpen: true };
  broadcastState(roomId);
}

// Record the last moment any game action occurred in a room.
function touchRoom(roomId: string) {
  lastMoveAt.set(roomId, Date.now());
}

// Watchdog: fires every 7 s; if a bot's turn has been stalled for >14 s, re-kick it.
function startWatchdog(roomId: string) {
  stopWatchdog(roomId);
  const id = setInterval(() => {
    const room = rooms.get(roomId);
    if (!room || room.state.phase !== 'playing') { stopWatchdog(roomId); return; }
    const since = Date.now() - (lastMoveAt.get(roomId) ?? 0);
    const cur = room.state.players[room.state.currentPlayerIndex];
    if (since > 14_000 && cur?.isBot) {
      console.log(`[watchdog] Rescuing stuck bot turn in room ${roomId} (stalled ${since}ms)`);
      executeBotTurn(roomId);
    } else if (since > 30_000 && cur && !cur.isBot && !cur.connected) {
      // Disconnected human holding the turn — auto-advance so the game doesn't stall
      console.log(`[watchdog] Auto-advancing disconnected player ${cur.name} in room ${roomId} (stalled ${since}ms)`);
      touchRoom(roomId);
      room.state = advanceTurnSkippingInactive(room.state);
      broadcastState(roomId);
      scheduleBotTurnIfNeeded(roomId);
    }
  }, 7_000);
  roomWatchdogs.set(roomId, id);
}

function stopWatchdog(roomId: string) {
  const id = roomWatchdogs.get(roomId);
  if (id !== undefined) { clearInterval(id); roomWatchdogs.delete(roomId); }
}

// ── Bot helpers ────────────────────────────────────────────────────────────────
function scheduleBotTurnIfNeeded(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.state.phase !== 'playing') return;
  const cur = room.state.players[room.state.currentPlayerIndex];
  if (cur?.isBot && !pendingBotTimers.has(roomId)) {
    pendingBotTimers.add(roomId);
    setTimeout(() => {
      pendingBotTimers.delete(roomId);
      executeBotTurn(roomId);
    }, 5_000);
  }
}

function executeBotTurn(roomId: string) {
  pendingBotTimers.delete(roomId); // clear any stale timer flag (e.g. watchdog path)
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.state.phase !== 'playing') return;

  const bot = room.state.players[room.state.currentPlayerIndex];
  if (!bot?.isBot) return;

  touchRoom(roomId); // mark activity so watchdog won't double-fire

  let action: ReturnType<typeof computeBotAction>;
  try {
    action = computeBotAction(room.state, bot.id);
  } catch (err) {
    console.error(`[bot] computeBotAction threw in room ${roomId}:`, err);
    room.state = advanceTurnSkippingInactive(room.state);
    broadcastState(roomId);
    scheduleBotTurnIfNeeded(roomId);
    return;
  }

  switch (action.type) {
    case 'declare_symbol': {
      room.state = applyDragonDeclaration(room.state, action.symbol);
      openMatchWindow(roomId);
      return;
    }
    case 'declare_color': {
      room.state = applyPeacockDeclaration(room.state, action.color);
      openMatchWindow(roomId);
      return;
    }
    case 'play_card': {
      const [s2, card] = removeFromHand({ ...room.state, matchWindowOpen: false }, bot.id, action.cardId);
      if (!card) break;
      room.state = applyPlay(s2, bot.id, card);

      // Auto-announce ZAR if bot now has 1 card
      const updatedBot = room.state.players.find(p => p.id === bot.id);
      if (updatedBot && updatedBot.hand.length === 1 && !updatedBot.announcedLastCard) {
        room.state = {
          ...room.state,
          players: room.state.players.map(p =>
            p.id === bot.id ? { ...p, announcedLastCard: true } : p
          ),
        };
        io.to(roomId).emit('last_card_announced', { playerName: bot.name });
      }

      // Check if bot went out
      const afterBot = room.state.players.find(p => p.id === bot.id);
      if (afterBot && afterBot.hand.length === 0) {
        room.state = checkRoundOver(room.state);
        broadcastState(roomId);
        return;
      }

      // Always open match window — even for Dragon/Peacock — so humans can counter-match
      openMatchWindow(roomId);
      return;
    }
    case 'play_double': {
      const [s2, card1] = removeFromHand({ ...room.state, matchWindowOpen: false }, bot.id, action.cardId1);
      const [s3, card2] = removeFromHand(s2, bot.id, action.cardId2);
      if (!card1 || !card2) break;
      room.state = applyDouble(s3, bot.id, card1, card2);

      openMatchWindow(roomId);
      return;
    }
    case 'draw': {
      if (room.state.pendingDrawCount > 0) {
        // Forced wasp draw — bot keeps turn to play or pass
        room.state = drawCards(room.state, bot.id, room.state.pendingDrawCount);
        room.state = { ...room.state, pendingDrawCount: 0, drawnThisTurn: true };
        broadcastState(roomId);
        // Re-run bot logic so it can play a drawn card or pass
        setTimeout(() => executeBotTurn(roomId), 1_000);
      } else {
        // Voluntary draw — then try to play the drawn card
        room.state = drawCards(room.state, bot.id, 1);
        room.state = { ...room.state, drawnThisTurn: true };
        const updatedBot = room.state.players.find(p => p.id === bot.id);
        const drawnCard = updatedBot?.hand[updatedBot.hand.length - 1];
        if (drawnCard && canPlay(drawnCard, room.state)) {
          const [s2, card] = removeFromHand(room.state, bot.id, drawnCard.id);
          if (card) {
            room.state = applyPlay(s2, bot.id, card);
            if (room.state.waitingForDeclaration) {
              broadcastState(roomId);
              setTimeout(() => executeBotTurn(roomId), 400);
              return;
            }
            openMatchWindow(roomId);
            return;
          }
        }
        // Cannot play drawn card — pass
        room.state = advanceTurnSkippingInactive(room.state);
        broadcastState(roomId);
        scheduleBotTurnIfNeeded(roomId);
      }
      return;
    }
    case 'pass': {
      room.state = advanceTurnSkippingInactive(room.state);
      broadcastState(roomId);
      scheduleBotTurnIfNeeded(roomId);
      return;
    }
  }
}

// ── Socket handlers ────────────────────────────────────────────────────────────
io.on('connection', (socket: Socket) => {
  let currentRoomId: string | null = null;

  // Simple per-connection rate limiter: max 30 game-action events per second
  let rateCount = 0;
  let rateWindowStart = Date.now();
  function isRateLimited(): boolean {
    const now = Date.now();
    if (now - rateWindowStart >= 1000) { rateCount = 0; rateWindowStart = now; }
    return ++rateCount > 30;
  }

  function getRoomAndPlayer() {
    if (isRateLimited()) return null;
    if (!currentRoomId) return null;
    const room = rooms.get(currentRoomId);
    if (!room) return null;
    const player = room.state.players.find(p => p.id === socket.id);
    if (!player) return null;
    return { room, player };
  }

  function emitError(msg: string) {
    socket.emit('error', { message: msg });
  }

  // ── get_rooms ── returns open lobby rooms so the client can show a "join?" prompt
  socket.on('get_rooms', () => {
    const available: { roomId: string; hostName: string; playerCount: number }[] = [];
    for (const [roomId, room] of rooms.entries()) {
      if (room.state.phase !== 'lobby') continue;
      if (room.state.players.length >= 9) continue;
      const host = room.state.players.find(p => p.id === room.hostId);
      available.push({ roomId, hostName: host?.name ?? 'Host', playerCount: room.state.players.length });
    }
    socket.emit('rooms_available', { rooms: available });
  });

  // ── create_room ──
  socket.on('create_room', ({ playerName, targetScore }: { playerName: string; targetScore: number }) => {
    const roomId = genRoomId();
    const validScore = Math.max(25, Math.min(200, Math.round((Number(targetScore) || 50) / 25) * 25));
    const player = { id: socket.id, name: (playerName.trim() || 'Player').slice(0, 20), hand: [], score: 0, connected: true, announcedLastCard: false };
    const state: GameState = {
      phase: 'lobby',
      players: [player],
      drawPile: [],
      playPile: [],
      currentPlayerIndex: 0,
      direction: 'cw',
      pendingDrawCount: 0,
      skipsRemaining: 0,
      waitingForDeclaration: false,
      drawnThisTurn: false,
      dealerIndex: 0,
      targetScore: validScore,
      matchWindowOpen: false,
      spectators: [],
    };
    rooms.set(roomId, { id: roomId, hostId: socket.id, state });
    socket.join(roomId);
    currentRoomId = roomId;
    socket.emit('room_created', { roomId });
    broadcastRoomInfo(roomId);
  });

  // ── join_room ──
  socket.on('join_room', ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    const rid = roomId.toUpperCase();
    const room = rooms.get(rid);
    if (!room) { emitError('Room not found.'); return; }

    const name = (playerName.trim() || 'Player').slice(0, 20);

    if (room.state.phase === 'lobby') {
      // Enforce name uniqueness in lobby
      if (room.state.players.some(p => p.name === name)) {
        emitError('That name is already taken in this room.'); return;
      }
      if (room.state.players.length >= 9) { emitError('Room is full (max 9 players).'); return; }

      const player = { id: socket.id, name, hand: [], score: 0, connected: true, announcedLastCard: false };
      room.state = { ...room.state, players: [...room.state.players, player] };
      socket.join(rid);
      currentRoomId = rid;
      socket.emit('room_joined', { roomId: rid });
      broadcastRoomInfo(rid);
      return;
    }

    // Game in progress — check for reconnect
    const disconnected = room.state.players.find(p => p.name === name && !p.connected && !p.isBot);
    if (disconnected) {
      const oldId = disconnected.id;
      clearTimeout(disconnected.reconnectTimer);
      disconnected.reconnectTimer = undefined;
      disconnected.id = socket.id;
      disconnected.connected = true;
      // Transfer host if needed
      if (room.hostId === oldId) room.hostId = socket.id;
      socket.join(rid);
      currentRoomId = rid;
      socket.emit('room_joined', { roomId: rid });
      broadcastRoomInfo(rid);
      broadcastState(rid);
      return;
    }

    // Otherwise join as spectator
    room.state = {
      ...room.state,
      spectators: [...room.state.spectators, { id: socket.id, name }],
    };
    socket.join(rid);
    currentRoomId = rid;
    socket.emit('room_joined', { roomId: rid });
    broadcastRoomInfo(rid);
    broadcastState(rid);
  });

  // ── start_game ──
  socket.on('start_game', () => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    if (socket.id !== room.hostId) { emitError('Only the host can start the game.'); return; }
    if (room.state.players.length < 2) { emitError('Need at least 2 players.'); return; }

    // Suggest bots if fewer than 4 human players
    if (room.state.players.length < 4) {
      socket.emit('suggest_bots', {
        currentCount: room.state.players.length,
        botsNeeded: 4 - room.state.players.length,
      });
      return;
    }

    room.state = startRound(room.state);
    broadcastState(currentRoomId!);
    touchRoom(currentRoomId!);
    startWatchdog(currentRoomId!);
    scheduleBotTurnIfNeeded(currentRoomId!);
  });

  // ── confirm_bots ──
  socket.on('confirm_bots', ({ confirm }: { confirm: boolean }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    if (socket.id !== room.hostId) return;
    if (room.state.phase !== 'lobby') return;

    if (confirm) {
      const botsNeeded = 4 - room.state.players.length;
      const newBots = [];
      for (let i = 0; i < botsNeeded; i++) {
        const botIdx = room.state.players.filter(p => p.isBot).length + i;
        const botName = BOT_NAMES[botIdx % BOT_NAMES.length] ?? `Bot ${botIdx + 1}`;
        newBots.push({
          id: `bot_${botIdx + 1}`,
          name: botName,
          hand: [],
          score: 0,
          connected: true,
          announcedLastCard: false,
          isBot: true as const,
        });
      }
      room.state = { ...room.state, players: [...room.state.players, ...newBots] };
      broadcastRoomInfo(currentRoomId!);
    }

    if (room.state.players.length < 2) { emitError('Need at least 2 players.'); return; }
    room.state = startRound(room.state);
    broadcastState(currentRoomId!);
    touchRoom(currentRoomId!);
    startWatchdog(currentRoomId!);
    scheduleBotTurnIfNeeded(currentRoomId!);
  });

  // ── play_card ──
  socket.on('play_card', ({ cardId }: { cardId: string }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room, player } = ctx;
    const s = { ...room.state, matchWindowOpen: false };

    if (s.phase !== 'playing') { emitError('Game not in progress.'); return; }
    if (s.waitingForDeclaration) { emitError('Waiting for symbol/color declaration.'); return; }
    if (s.players[s.currentPlayerIndex].id !== socket.id) { emitError("It's not your turn."); return; }

    const cardInHand = player.hand.find(c => c.id === cardId);
    if (!cardInHand) { emitError('Card not in your hand.'); return; }
    if (!canPlay(cardInHand, s)) { emitError('Cannot play that card now.'); return; }

    const [newState, card] = removeFromHand(s, socket.id, cardId);
    if (!card) return;
    room.state = applyPlay(newState, socket.id, card);
    touchRoom(currentRoomId!);

    // Check if player just played last card
    const updatedPlayer = room.state.players.find(p => p.id === socket.id);
    if (updatedPlayer && updatedPlayer.hand.length === 0) {
      room.state = checkRoundOver(room.state);
      broadcastState(currentRoomId!);
      return;
    }

    openMatchWindow(currentRoomId!);
  });

  // ── play_double ──
  socket.on('play_double', ({ cardId1, cardId2 }: { cardId1: string; cardId2: string }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room, player } = ctx;
    const s = { ...room.state, matchWindowOpen: false };

    if (s.phase !== 'playing') return;
    if (s.waitingForDeclaration) return;
    if (s.players[s.currentPlayerIndex].id !== socket.id) { emitError("It's not your turn."); return; }

    const c1 = player.hand.find(c => c.id === cardId1);
    const c2 = player.hand.find(c => c.id === cardId2);
    if (!c1 || !c2) { emitError('Cards not in your hand.'); return; }
    if (!isDouble(c1, c2)) { emitError('Cards are not a matching pair.'); return; }
    if (!canPlay(c1, s)) { emitError('Cannot play that card now.'); return; }

    // Cannot go out on a double
    if (player.hand.length === 2) { emitError('Cannot go out on a double.'); return; }

    let [s2, card1] = removeFromHand(s, socket.id, cardId1);
    let [s3, card2] = removeFromHand(s2, socket.id, cardId2);
    if (!card1 || !card2) return;

    room.state = applyDouble(s3, socket.id, card1, card2);
    touchRoom(currentRoomId!);

    openMatchWindow(currentRoomId!);
  });

  // ── declare_symbol (after dragon) ──
  socket.on('declare_symbol', ({ symbol }: { symbol: CardSymbol }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    if (!room.state.waitingForDeclaration) return;
    const top = room.state.playPile[room.state.playPile.length - 1];
    if (!top || top.power !== 'dragon') return;
    room.state = applyDragonDeclaration(room.state, symbol);
    touchRoom(currentRoomId!);
    openMatchWindow(currentRoomId!);
  });

  // ── declare_color (after peacock) ──
  socket.on('declare_color', ({ color }: { color: CardColor }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    if (!room.state.waitingForDeclaration) return;
    const top = room.state.playPile[room.state.playPile.length - 1];
    if (!top || top.power !== 'peacock') return;
    room.state = applyPeacockDeclaration(room.state, color);
    touchRoom(currentRoomId!);
    openMatchWindow(currentRoomId!);
  });

  // ── draw_card ──
  socket.on('draw_card', () => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    let s = room.state;

    if (s.phase !== 'playing') return;
    if (s.waitingForDeclaration) return;
    if (s.players[s.currentPlayerIndex].id !== socket.id) { emitError("It's not your turn."); return; }

    if (s.pendingDrawCount > 0) {
      // Wasp penalty: draw all cards, but player keeps their turn to play or pass
      s = drawCards(s, socket.id, s.pendingDrawCount);
      s = { ...s, pendingDrawCount: 0, drawnThisTurn: true };
      room.state = s;
      touchRoom(currentRoomId!);
      broadcastState(currentRoomId!);
    } else {
      // Voluntary draw: only allowed once per turn
      if (s.drawnThisTurn) { emitError('You already drew a card this turn.'); return; }
      s = drawCards(s, socket.id, 1);
      s = { ...s, drawnThisTurn: true };
      room.state = s;
      touchRoom(currentRoomId!);
      broadcastState(currentRoomId!);
      // Player can still play or pass; turn does NOT auto-advance
    }
  });

  // ── pass ──
  socket.on('pass', () => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    let s = room.state;

    if (s.phase !== 'playing') return;
    if (s.waitingForDeclaration) return;
    if (s.players[s.currentPlayerIndex].id !== socket.id) { emitError("It's not your turn."); return; }
    if (s.pendingDrawCount > 0) { emitError('You must draw your wasp cards first.'); return; }

    s = advanceTurnSkippingInactive(s);
    room.state = s;
    touchRoom(currentRoomId!);
    broadcastState(currentRoomId!);
    scheduleBotTurnIfNeeded(currentRoomId!);
  });

  // ── match_card ──
  socket.on('match_card', ({ cardId }: { cardId: string }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room, player } = ctx;
    const s = room.state;

    if (s.phase !== 'playing') return;
    if (!s.matchWindowOpen) return;
    if (s.players[s.currentPlayerIndex].id === socket.id) { emitError("It's your turn — play normally."); return; }

    const top = s.playPile[s.playPile.length - 1];
    const cardInHand = player.hand.find(c => c.id === cardId);
    if (!cardInHand) { emitError('Card not in your hand.'); return; }
    if (!top || !isMatch(cardInHand, top)) { emitError('Card does not match.'); return; }

    const matchedPlayer = s.players[s.currentPlayerIndex];

    // Remove card from matcher's hand
    const [s2, card] = removeFromHand(s, socket.id, cardId);
    if (!card) return;

    const matcherIndex = s2.players.findIndex(p => p.id === socket.id);

    touchRoom(currentRoomId!);

    if (card.kind === 'command' && card.command === 'wasp') {
      // Wasp match: stack the draw count, no penalty for the player who played the wasp.
      // Set current player to matcher so applyPlay's advanceTurn goes to the player after them.
      const stateForMatch = { ...s2, currentPlayerIndex: matcherIndex, matchWindowOpen: false };
      const waspState = applyPlay(stateForMatch, socket.id, card);
      room.state = checkRoundOver(waspState);
      if (room.state.phase === 'playing') {
        openMatchWindow(currentRoomId!);
      } else {
        broadcastState(currentRoomId!);
      }
      return;
    }

    // Power card match: matcher takes the declaration; original player draws 1 penalty
    if (card.kind === 'power') {
      let newState = drawCards(s2, matchedPlayer.id, 1);
      newState = {
        ...newState,
        playPile: [...newState.playPile, card],
        currentPlayerIndex: matcherIndex,
        matchWindowOpen: false,
        waitingForDeclaration: true, // matcher now declares
      };
      room.state = checkRoundOver(newState);
      broadcastState(currentRoomId!);
      scheduleBotTurnIfNeeded(currentRoomId!);
      return;
    }

    // Normal match: penalty draw for original player, then place card
    let newState = drawCards(s2, matchedPlayer.id, 1);
    newState = { ...newState, playPile: [...newState.playPile, card], currentPlayerIndex: matcherIndex, matchWindowOpen: false };
    newState = advanceTurnSkippingInactive(newState);

    room.state = checkRoundOver(newState);
    broadcastState(currentRoomId!);
    scheduleBotTurnIfNeeded(currentRoomId!);
  });

  // ── announce_last_card ──
  socket.on('announce_last_card', () => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.hand.length !== 1) return;
    room.state = {
      ...room.state,
      players: room.state.players.map(p =>
        p.id === socket.id ? { ...p, announcedLastCard: true } : p
      ),
    };
    io.to(currentRoomId!).emit('last_card_announced', { playerName: player.name });
    broadcastState(currentRoomId!);
  });

  // ── challenge_last_card ──
  socket.on('challenge_last_card', ({ targetPlayerId }: { targetPlayerId: string }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    const target = room.state.players.find(p => p.id === targetPlayerId);
    if (!target) return;
    if (target.hand.length !== 1) return;
    if (target.announcedLastCard) { emitError('Player already announced last card.'); return; }

    // Target must draw 1 penalty
    room.state = drawCards(room.state, targetPlayerId, 1);
    io.to(currentRoomId!).emit('last_card_challenge', { challengerName: room.state.players.find(p => p.id === socket.id)?.name, targetName: target.name });
    broadcastState(currentRoomId!);
  });

  // ── next_round ──
  socket.on('next_round', () => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    if (socket.id !== room.hostId) return;
    if (room.state.phase !== 'round_over') return;
    cancelRoomCleanup(currentRoomId!);
    room.state = startRound(room.state);
    broadcastState(currentRoomId!);
    touchRoom(currentRoomId!);
    startWatchdog(currentRoomId!);
    scheduleBotTurnIfNeeded(currentRoomId!);
  });

  // ── kick_player ──
  socket.on('kick_player', ({ playerId }: { playerId: string }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    if (socket.id !== room.hostId) return;
    if (playerId === socket.id) return; // can't kick yourself
    const target = room.state.players.find(p => p.id === playerId);
    if (!target || target.isBot) return;
    clearTimeout(target.reconnectTimer);
    io.to(playerId).emit('kicked', { message: 'You were removed from the game by the host.' });
    io.sockets.sockets.get(playerId)?.disconnect(true);
    if (room.state.phase === 'lobby') {
      room.state = { ...room.state, players: room.state.players.filter(p => p.id !== playerId) };
      broadcastRoomInfo(currentRoomId!);
    } else {
      const removedIdx = room.state.players.findIndex(p => p.id === playerId);
      const newPlayers = room.state.players.filter(p => p.id !== playerId);
      let newCurrentIdx = room.state.currentPlayerIndex;
      if (removedIdx < newCurrentIdx) newCurrentIdx -= 1;
      else if (removedIdx === newCurrentIdx) newCurrentIdx = newCurrentIdx % Math.max(1, newPlayers.length);
      room.state = { ...room.state, players: newPlayers, currentPlayerIndex: newCurrentIdx };
      const activePlayers = newPlayers.filter(p => p.connected || p.isBot);
      if (activePlayers.length < 2 && room.state.phase === 'playing') {
        room.state = { ...room.state, phase: 'game_over' };
      }
      broadcastRoomInfo(currentRoomId!);
      broadcastState(currentRoomId!);
      scheduleBotTurnIfNeeded(currentRoomId!);
    }
  });

  // ── rematch ── (host resets scores and returns to lobby for a fresh game)
  socket.on('rematch', () => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    if (socket.id !== room.hostId) return;
    if (room.state.phase !== 'game_over') return;
    cancelRoomCleanup(currentRoomId!);
    stopWatchdog(currentRoomId!);
    room.state = {
      ...room.state,
      phase: 'lobby',
      players: room.state.players.map(p => ({ ...p, score: 0, hand: [], announcedLastCard: false })),
      drawPile: [],
      playPile: [],
      pendingDrawCount: 0,
      skipsRemaining: 0,
      waitingForDeclaration: false,
      drawnThisTurn: false,
      matchWindowOpen: false,
      declaredSymbol: undefined,
      declaredColor: undefined,
      activeColor: undefined,
      activeSymbol: undefined,
      activeCommand: undefined,
      roundWinnerId: undefined,
    };
    broadcastRoomInfo(currentRoomId!);
    broadcastState(currentRoomId!);
  });

  // ── voice_join ──
  socket.on('voice_join', () => {
    if (!currentRoomId) return;
    if (!voiceRooms.has(currentRoomId)) voiceRooms.set(currentRoomId, new Set());
    const participants = voiceRooms.get(currentRoomId)!;
    const existingPeers = [...participants].filter(id => id !== socket.id);
    participants.add(socket.id);
    // Send the joiner the list of existing participants so they can initiate offers
    socket.emit('voice_peer_list', { peers: existingPeers });
    // Notify existing participants that someone new joined
    existingPeers.forEach(peerId => io.to(peerId).emit('voice_peer_joined', { peerId: socket.id }));
  });

  // ── voice_leave ──
  socket.on('voice_leave', () => { removeFromVoice(socket.id); });

  // ── WebRTC signaling relay ──
  function inSameRoom(otherSocketId: string): boolean {
    if (!currentRoomId) return false;
    const room = rooms.get(currentRoomId);
    if (!room) return false;
    return room.state.players.some(p => p.id === otherSocketId)
      || room.state.spectators.some(s => s.id === otherSocketId);
  }

  socket.on('voice_offer', ({ targetId, offer }: { targetId: string; offer: unknown }) => {
    if (!inSameRoom(targetId)) return;
    io.to(targetId).emit('voice_offer', { fromId: socket.id, offer });
  });
  socket.on('voice_answer', ({ targetId, answer }: { targetId: string; answer: unknown }) => {
    if (!inSameRoom(targetId)) return;
    io.to(targetId).emit('voice_answer', { fromId: socket.id, answer });
  });
  socket.on('voice_ice', ({ targetId, candidate }: { targetId: string; candidate: unknown }) => {
    if (!inSameRoom(targetId)) return;
    io.to(targetId).emit('voice_ice', { fromId: socket.id, candidate });
  });

  // ── disconnect ──
  socket.on('disconnect', () => {
    removeFromVoice(socket.id);
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const roomId = currentRoomId;

    // Check if this was a spectator
    const specIdx = room.state.spectators.findIndex(s => s.id === socket.id);
    if (specIdx !== -1) {
      room.state = {
        ...room.state,
        spectators: room.state.spectators.filter(s => s.id !== socket.id),
      };
      broadcastRoomInfo(roomId);
      return;
    }

    // Mark player as disconnected
    room.state = {
      ...room.state,
      players: room.state.players.map(p =>
        p.id === socket.id ? { ...p, connected: false } : p
      ),
    };

    const player = room.state.players.find(p => p.id === socket.id);
    if (!player) { broadcastRoomInfo(roomId); return; }

    if (room.state.phase === 'lobby') {
      // In lobby: remove immediately, update host if needed
      room.state = { ...room.state, players: room.state.players.filter(p => p.id !== socket.id) };
      if (room.hostId === socket.id && room.state.players.length > 0) {
        room.hostId = room.state.players[0].id;
      }
      if (room.state.players.length === 0) {
        scheduleRoomCleanup(roomId);
      }
      broadcastRoomInfo(roomId);
      broadcastState(roomId);
      return;
    }

    // In game: if it's their turn, auto-advance
    const s = room.state;
    if (s.phase === 'playing' && s.players[s.currentPlayerIndex].id === socket.id) {
      if (s.waitingForDeclaration) {
        // Auto-resolve declaration randomly
        const top = s.playPile[s.playPile.length - 1];
        if (top?.power === 'dragon') {
          room.state = applyDragonDeclaration(s, randItem(SYMBOLS));
        } else if (top?.power === 'peacock') {
          room.state = applyPeacockDeclaration(s, randItem(COLORS));
        } else {
          room.state = advanceTurnSkippingInactive(s);
        }
      } else {
        room.state = advanceTurnSkippingInactive(s);
      }
      broadcastState(roomId);
      scheduleBotTurnIfNeeded(roomId);
    }

    // Start 90-second reconnect grace period
    const playerId = socket.id;
    const playerInState = room.state.players.find(p => p.id === playerId);
    if (playerInState) playerInState.disconnectedAt = Date.now();
    startReconnectTimer(roomId, playerId, RECONNECT_MS);

    broadcastRoomInfo(roomId);
    broadcastState(roomId);
  });
});

// Load persisted rooms from Redis before accepting connections
await loadRoomsFromRedis();

httpServer.listen(PORT, () => {
  console.log(`ZAR server running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('SIGTERM', () => {
  console.log('[shutdown] SIGTERM received — notifying players and draining…');
  io.emit('server_restart', { message: 'Server is restarting. Reconnect in a few seconds with your same name.' });
  setTimeout(() => {
    io.close();
    httpServer.close(() => {
      redis?.disconnect();
      process.exit(0);
    });
  }, 3000);
});
