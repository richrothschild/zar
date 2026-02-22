# ZAR — Multiplayer Card Game

## Project Overview
Full-stack real-time multiplayer card game built with React + Vite (frontend) and Express + Socket.io (backend). All game state lives on the server; clients are pure views.

## Architecture
- **Frontend**: React 19 + TypeScript + Vite, runs on port 5173 in dev
- **Backend**: Express 5 + Socket.io, runs on port 3001
- **Dev**: `npm run dev` starts both via `concurrently`
- **Prod**: `npm run build` compiles frontend into `dist/`, then `npm start` serves everything from port 3001

## Key Commands
```bash
npm run dev        # start both server + client (hot-reload)
npm run build      # compile frontend for production
npm start          # run production server (serves dist/)
```

## File Structure
```
server/
  types.ts         # shared game types (Card, Player, GameState, etc.)
  deck.ts          # 62-card deck builder + shuffle
  gameLogic.ts     # canPlay, applyPlay, applyDouble, scoring, buildClientState
  index.ts         # Express + Socket.io server, in-memory room store

src/
  types.ts         # frontend copy of server types
  socket.ts        # singleton Socket.io client (autoConnect: false)
  App.tsx          # root — shows Lobby or GameBoard based on game phase
  components/
    Card.tsx        # card visual (emoji, color, points)
    Hand.tsx        # player's hand, click-to-select, double play, match window
    GameBoard.tsx   # main game layout (sidebar, play pile, draw pile, hand)
    PlayerList.tsx  # sidebar player list with challenge button
    Lobby.tsx       # create/join room UI
    DragonModal.tsx # symbol picker (after Dragon played)
    PeacockModal.tsx# color picker (after Peacock played)
```

## Card System (62 cards)
| Type    | Count | Rule |
|---------|-------|------|
| Basic   | 36    | 6 symbols × 3 colors × 2 copies — play on same color or symbol |
| Command | 18    | Wasp (draw 2), Frog (skip), Crab (reverse) × 3 colors × 2 copies |
| Power   | 8     | Dragon (change symbol) × 4, Peacock (change color) × 4 |

Point values: Basic=5, Command=15, Power=25

## Socket Events
**Client → Server:** `create_room`, `join_room`, `start_game`, `play_card`, `play_double`, `draw_card`, `pass`, `match_card`, `declare_symbol`, `declare_color`, `announce_last_card`, `challenge_last_card`, `next_round`

**Server → Client:** `room_update`, `room_created`, `room_joined`, `game_state`, `error`, `last_card_announced`, `last_card_challenge`

## Important Game Rules
- Server is authoritative — never trust client for game state
- **Match window**: 1.5s after a card is played where any player can match it out of turn (matched player draws 1 penalty)
- **Wasp stacking**: `pendingDrawCount` accumulates; only another Wasp can redirect it
- **Dragon/Peacock**: sets `waitingForDeclaration = true`; server holds turn until `declare_symbol`/`declare_color` received
- **Last card**: player must call `announce_last_card` when playing down to 1 card, or any opponent can `challenge_last_card` to make them draw 1
- Cannot go out on a double play

## TypeScript Notes
- `verbatimModuleSyntax` is enabled — always use `import type` for type-only imports
- Server files use `.js` extensions in imports (ESM) but source is `.ts`
- `tsx` is in `dependencies` (not devDependencies) because `npm start` uses it in production

## Deployment
- **Railway**: reads `railway.json` — connect GitHub repo, auto-deploys
- **Render**: reads `render.yaml` — connect GitHub repo, auto-deploys
- `PORT` env var is respected by the server (`process.env.PORT ?? 3001`)
