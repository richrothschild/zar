import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Room, GameState, Card, CardSymbol, CardColor } from './types.js';
import {
  startRound, drawCards, removeFromHand, applyPlay, applyDouble,
  applyDragonDeclaration, applyPeacockDeclaration,
  checkRoundOver, buildClientState, canPlay, isMatch, isDouble, advanceTurn,
} from './gameLogic.js';

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
  for (const player of room.state.players) {
    const clientState = buildClientState(room.state, player.id);
    io.to(player.id).emit('game_state', clientState);
  }
}

function broadcastRoomInfo(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('room_update', {
    roomId,
    hostId: room.hostId,
    players: room.state.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })),
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
    };
    rooms.set(roomId, { id: roomId, hostId: socket.id, state });
    socket.join(roomId);
    currentRoomId = roomId;
    socket.emit('room_created', { roomId });
    broadcastRoomInfo(roomId);
  });

  // ── join_room ──
  socket.on('join_room', ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) { emitError('Room not found.'); return; }
    if (room.state.phase !== 'lobby') { emitError('Game already started.'); return; }
    if (room.state.players.length >= 9) { emitError('Room is full (max 9 players).'); return; }

    const player = { id: socket.id, name: playerName.trim() || 'Player', hand: [], score: 0, connected: true, announcedLastCard: false };
    room.state = { ...room.state, players: [...room.state.players, player] };
    socket.join(roomId.toUpperCase());
    currentRoomId = roomId.toUpperCase();
    socket.emit('room_joined', { roomId: roomId.toUpperCase() });
    broadcastRoomInfo(roomId.toUpperCase());
  });

  // ── start_game ──
  socket.on('start_game', () => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room } = ctx;
    if (socket.id !== room.hostId) { emitError('Only the host can start the game.'); return; }
    if (room.state.players.length < 2) { emitError('Need at least 2 players.'); return; }
    room.state = startRound(room.state);
    broadcastState(currentRoomId!);
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
      // Wasp penalty: draw all pending cards, then auto-advance turn
      s = drawCards(s, socket.id, s.pendingDrawCount);
      s = { ...s, pendingDrawCount: 0 };
      s = advanceTurn(s);
    } else {
      // Voluntary draw: only allowed once per turn
      if (s.drawnThisTurn) { emitError('You already drew a card this turn.'); return; }
      s = drawCards(s, socket.id, 1);
      s = { ...s, drawnThisTurn: true };
      // Player can still play or pass; turn does NOT auto-advance
    }

    room.state = s;
    broadcastState(currentRoomId!);
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

    s = advanceTurn(s);
    room.state = s;
    broadcastState(currentRoomId!);
  });

  // ── match_card ──
  socket.on('match_card', ({ cardId }: { cardId: string }) => {
    const ctx = getRoomAndPlayer();
    if (!ctx) return;
    const { room, player } = ctx;
    const s = room.state;

    if (!s.matchWindowOpen) { emitError('Match window has closed.'); return; }
    if (s.players[s.currentPlayerIndex].id === socket.id) { emitError("It's your turn — play normally."); return; }

    const top = s.playPile[s.playPile.length - 1];
    const cardInHand = player.hand.find(c => c.id === cardId);
    if (!cardInHand) { emitError('Card not in your hand.'); return; }
    if (!top || !isMatch(cardInHand, top)) { emitError('Card does not match.'); return; }

    // Close match window timer
    clearTimeout(matchTimers.get(currentRoomId!));
    matchTimers.delete(currentRoomId!);

    // The matched player draws 1 penalty card
    const matchedPlayer = s.players[s.currentPlayerIndex];
    let newState = drawCards(s, matchedPlayer.id, 1);

    // Remove card from matcher's hand and play it
    const [s2, card] = removeFromHand(newState, socket.id, cardId);
    if (!card) return;

    // Place card and set turn to player AFTER the matcher
    const matcherIndex = s2.players.findIndex(p => p.id === socket.id);
    newState = { ...s2, playPile: [...s2.playPile, card], currentPlayerIndex: matcherIndex, matchWindowOpen: false };
    newState = advanceTurn(newState);

    room.state = checkRoundOver(newState);
    broadcastState(currentRoomId!);
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
    room.state = {
      ...room.state,
      players: room.state.players.map(p =>
        p.id === socket.id ? { ...p, connected: false } : p
      ),
    };
    broadcastRoomInfo(currentRoomId);
    broadcastState(currentRoomId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`ZAR server running on port ${PORT}`);
});
