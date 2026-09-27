# Chat App

A real-time, multi-room chat app. One Node/WebSocket/PostgreSQL server backs two clients that share the same frontend code: an Electron desktop app and a plain browser client.

## Features

- Multiple rooms, created on the fly from the sidebar.
- Real-time messaging over WebSocket, with edit and delete (only by the message's own author).
- Typing indicators, an online user list, and message history on joining a room.
- GIF search and trending GIFs via Giphy, proxied through the server so the API key is never sent to the client.
- Automatic reconnect if the connection drops, with a server-side heartbeat to survive host idle timeouts (e.g. Render).

## Architecture

```
Electron desktop client  --\
                            }--  WebSocket  --  server.js  --  PostgreSQL
Browser client (public/)  --/                      |
                                                    +-- /giphy/search, /giphy/trending (proxied to Giphy's API)
```

The Electron app is a thin shell: `main.js` opens a window loading `public/index.html` and owns the WebSocket connection, relaying messages to the renderer over Electron's IPC. The browser client is the same `public/index.html` served directly by `server.js` and talks to the server over a plain WebSocket. `public/renderer.js` detects which environment it's running in and adapts accordingly.

## Tech stack

- **Server:** Node.js, `ws` (WebSocket), `pg` (PostgreSQL)
- **Desktop client:** Electron, with a context-isolated preload bridge (no Node integration in the renderer)
- **Browser client:** plain HTML/CSS/JavaScript, no build step
- **Data:** PostgreSQL (tables are created automatically on first start)

## Prerequisites

- Node.js 18+
- PostgreSQL, local or hosted (e.g. Render, Supabase)
- A [Giphy API key](https://developers.giphy.com/) (optional — GIF search is disabled without one)

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local configuration (PowerShell: use `Copy-Item` instead of `cp`):

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL` to your PostgreSQL connection string and `GIPHY_API_KEY` to your Giphy key. `.env` is gitignored. SSL is enabled automatically unless the database host is `localhost` or `127.0.0.1`.

3. Start the server:

   ```bash
   npm run server
   ```

4. Open two clients against it:
   - **Browser:** open http://localhost:3000 (or your configured `PORT`) in a normal browser tab. Open it twice to chat with yourself.
   - **Desktop:** `npm start`. The Electron app always connects to the deployed instance hardcoded in `main.js`, not to a local server — see Notes below.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `GIPHY_API_KEY` | no | Enables GIF search and trending GIFs |
| `PORT` | no | Defaults to `3000` |

## WebSocket protocol

Clients send JSON messages over the WebSocket; `type` selects the action.

| Client sends | Server does |
|---|---|
| `{ type: 'identify', username }` | Registers the connection under that username (no password) and replies `identified` |
| `{ type: 'join-room', room }` | Sends `history`: the room's last 50 messages |
| `{ type: 'get-rooms' }` / `{ type: 'create-room', room }` | Sends/broadcasts `room-list` |
| `{ type: 'chat', id, room, content, timestamp }` | Stores and broadcasts a `chat` message to the room |
| `{ type: 'edit-message', id, room, newContent }` | Updates the message if you're its author, and broadcasts `message-edited` |
| `{ type: 'delete-message', id, room }` | Soft-deletes the message if you're its author, and broadcasts `message-deleted` |
| `{ type: 'typing' }` / `{ type: 'stop-typing', room }` | Broadcasts `user-typing` / `user-stop-typing` to the room |

The username on `chat`, `edit-message` and `delete-message` is always taken from the connection's own `identify` call, not from the message payload, so a client cannot post, edit or delete as another user.

## Notes and limitations

This is a demo project, not production-ready.

- There's no authentication: any client can `identify` as any username with no password. Editing and deleting are restricted to the identified connection's own messages, but nothing stops someone from picking a name someone else is already using.
- The Electron client's server URL is hardcoded in `main.js` (`wss://...`), so it always talks to the deployed instance rather than a local `npm run server`. To test the desktop client against a local server, point that URL at `ws://localhost:<PORT>` temporarily.
- Messages are capped at 5000 characters, enforced by both the input and the server.
- Run a second desktop instance for local testing with `npm start -- --instance=2` (keeps a separate Electron user-data directory).

## License

[MIT](LICENSE)
