import { io, Socket } from 'socket.io-client';

// Vite proxies /socket.io → localhost:3001 in dev.
// In production, the same origin serves both.
export const socket: Socket = io({ autoConnect: false });
