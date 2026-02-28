import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Room, GameState, CardSymbol, CardColor } from './types.js';
import {
  startRound, drawCards, removeFromHand, applyPlay, applyDouble,
  applyDragonDeclaration, applyPeacockDeclaration,
  checkRoundOver, buildClientState, canPlay, isMatch, isDouble,
  advanceTurnSkippingInactive,
} from './gameLogic.js';
import { computeBotAction } from './botLogic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Serve built frontend in production
const distPath = join(__dirname, '../dist');
app.use(express.static(distPath));
app.use((_req, res) => res.sendFile(join(distPath, 'index.html')));

// ── In-memory store ────────────────────────────────────────────────────────────
const rooms = new Map<string, Room>();

// ── Voice chat participants ─────────────────────────────────────────────────────
const voiceRooms = new Map<string, Set<string>>(); // roomId → Set<socketId>

// ── Constants ──────────────────────────────────────────────────────────────────
const SYMBOLS: CardSymbol[] = ['galaxy', 'moon', 'cloud', 'sun', 'star', 'lightning'];
const COLORS: CardColor[] = ['yellow', 'blue', 'red'];
const RECONNECT_MS = 90_000;

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
  return Math.random().toString(36).substring(2, 7).toUpperCase();
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
}

function broadcastRoomInfo(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('room_update', {
    roomId,
    hostId: room.hostId,
    players: room.state.players.map(p => ({ id: p.id, name: p.name, connected: p.connected, isBot: p.isBot })),
    spectators: room.state.spectators.map(s => ({ id: s.id, name: s.name })),
    phase: room.state.phase,
  });
}

// ── Match window timer ─────────────────────────────────────────────────────────
const matchTimers = new Map<string, ReturnType<typeof setTimeout>>();

function openMatchWindow(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.state = { ...room.state, matchWindowOpen: true };
  broadcastState(roomId);

  const timer = setTimeout(() => {
    closeMatchWindow(roomId);
  }, 1500);
  matchTimers.set(roomId, timer);
}

function closeMatchWindow(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearTimeout(matchTimers.get(roomId));
  matchTimers.delete(roomId);
  room.state = { ...room.state, matchWindowOpen: false };
  room.state = checkRoundOver(room.state);
  broadcastState(roomId);
  scheduleBotTurnIfNeeded(roomId);
}

// ── Bot helpers ────────────────────────────────────────────────────────────────
function scheduleBotTurnIfNeeded(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.state.phase !== 'playing') return;
  const cur = room.state.players[room.state.currentPlayerIndex];
  if (cur?.isBot) setTimeout(() => executeBotTurn(roomId), 15000);
}

function executeBotTurn(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.state.phase !== 'playing') return;

  const bot = room.state.players[room.state.currentPlayerIndex];
  if (!bot?.isBot) return;

  const action = computeBotAction(room.state, bot.id);

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
      const [s2, card] = removeFromHand(room.state, bot.id, action.cardId);
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

      if (room.state.waitingForDeclaration) {
        broadcastState(roomId);
        setTimeout(() => executeBotTurn(roomId), 400);
        return;
      }

      openMatchWindow(roomId);
      return;
    }
    case 'play_double': {
      const [s2, card1] = removeFromHand(room.state, bot.id, action.cardId1);
      const [s3, card2] = removeFromHand(s2, bot.id, action.cardId2);
      if (!card1 || !card2) break;
      room.state = applyDouble(s3, bot.id, card1, card2);

      if (room.state.waitingForDeclaration) {
        broadcastState(roomId);
        setTimeout(() => executeBotTurn(roomId), 400);
        return;
      }

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
        setTimeout(() => executeBotTurn(roomId), 1500);
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

  function getRoomAndPlayer() {
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
    const player = { id: socket.id, name: playerName.trim() || 'Player', hand: [], score: 0, connected: true, announcedLastCard: false };
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
      targetScore: targetScore || 50,
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

    const name = playerName.trim() || 'Player';

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
        const botNum = room.state.players.filter(p => p.isBot).length + i + 1;
        newBots.push({
          id: `bot_${botNum}`,
          name: `Bot ${botNum}`,
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
    scheduleBotTurnIfNeeded(currentRoomId!);
  });

  // ── play_card ──
  socket.on('play_card', ({ cardId }: { cardId: string }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room, player } = ctx;
    const s = room.state;

    if (s.phase !== 'playing') { emitError('Game not in progress.'); return; }
    if (s.waitingForDeclaration) { emitError('Waiting for symbol/color declaration.'); return; }
    if (s.players[s.currentPlayerIndex].id !== socket.id) { emitError("It's not your turn."); return; }

    const cardInHand = player.hand.find(c => c.id === cardId);
    if (!cardInHand) { emitError('Card not in your hand.'); return; }
    if (!canPlay(cardInHand, s)) { emitError('Cannot play that card now.'); return; }

    const [newState, card] = removeFromHand(s, socket.id, cardId);
    if (!card) return;
    room.state = applyPlay(newState, socket.id, card);

    // Check if player just played last card
    const updatedPlayer = room.state.players.find(p => p.id === socket.id);
    if (updatedPlayer && updatedPlayer.hand.length === 0) {
      room.state = checkRoundOver(room.state);
      broadcastState(currentRoomId!);
      return;
    }

    if (!room.state.waitingForDeclaration) {
      openMatchWindow(currentRoomId!);
    } else {
      broadcastState(currentRoomId!);
    }
  });

  // ── play_double ──
  socket.on('play_double', ({ cardId1, cardId2 }: { cardId1: string; cardId2: string }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room, player } = ctx;
    const s = room.state;

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

    if (!room.state.waitingForDeclaration) {
      openMatchWindow(currentRoomId!);
    } else {
      broadcastState(currentRoomId!);
    }
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
      broadcastState(currentRoomId!);
    } else {
      // Voluntary draw: only allowed once per turn
      if (s.drawnThisTurn) { emitError('You already drew a card this turn.'); return; }
      s = drawCards(s, socket.id, 1);
      s = { ...s, drawnThisTurn: true };
      room.state = s;
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
    if (s.waitingForDeclaration) return;
    if (s.players[s.currentPlayerIndex].id === socket.id) { emitError("It's your turn — play normally."); return; }

    const top = s.playPile[s.playPile.length - 1];
    const cardInHand = player.hand.find(c => c.id === cardId);
    if (!cardInHand) { emitError('Card not in your hand.'); return; }
    if (!top || !isMatch(cardInHand, top)) { emitError('Card does not match.'); return; }

    // Close match window timer
    clearTimeout(matchTimers.get(currentRoomId!));
    matchTimers.delete(currentRoomId!);

    const matchedPlayer = s.players[s.currentPlayerIndex];

    // Remove card from matcher's hand
    const [s2, card] = removeFromHand(s, socket.id, cardId);
    if (!card) return;

    const matcherIndex = s2.players.findIndex(p => p.id === socket.id);

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
    room.state = startRound(room.state);
    broadcastState(currentRoomId!);
    scheduleBotTurnIfNeeded(currentRoomId!);
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
  socket.on('voice_offer', ({ targetId, offer }: { targetId: string; offer: unknown }) => {
    io.to(targetId).emit('voice_offer', { fromId: socket.id, offer });
  });
  socket.on('voice_answer', ({ targetId, answer }: { targetId: string; answer: unknown }) => {
    io.to(targetId).emit('voice_answer', { fromId: socket.id, answer });
  });
  socket.on('voice_ice', ({ targetId, candidate }: { targetId: string; candidate: unknown }) => {
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
    const timer = setTimeout(() => {
      const r = rooms.get(roomId);
      if (!r) return;
      const removedIdx = r.state.players.findIndex(p => p.id === playerId);
      if (removedIdx === -1) return; // already reconnected or removed

      const newPlayers = r.state.players.filter(p => p.id !== playerId);
      let newCurrentIdx = r.state.currentPlayerIndex;
      if (removedIdx < newCurrentIdx) {
        newCurrentIdx -= 1;
      } else if (removedIdx === newCurrentIdx) {
        newCurrentIdx = newCurrentIdx % Math.max(1, newPlayers.length);
      }

      r.state = { ...r.state, players: newPlayers, currentPlayerIndex: newCurrentIdx };

      // End game if fewer than 2 active players remain
      const activePlayers = newPlayers.filter(p => p.connected || p.isBot);
      if (activePlayers.length < 2 && r.state.phase === 'playing') {
        r.state = { ...r.state, phase: 'game_over' };
      }

      broadcastRoomInfo(roomId);
      broadcastState(roomId);
      scheduleBotTurnIfNeeded(roomId);
    }, RECONNECT_MS);

    // Store timer handle on the player object so reconnect can cancel it
    const playerInState = room.state.players.find(p => p.id === playerId);
    if (playerInState) playerInState.reconnectTimer = timer;

    broadcastRoomInfo(roomId);
    broadcastState(roomId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`ZAR server running on port ${PORT}`);
});
