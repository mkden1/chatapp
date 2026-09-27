require('dotenv').config();
const { WebSocketServer, WebSocket } = require('ws');
const { Pool } = require('pg');
const http = require('http');
const path = require('path');
const fs = require('fs');

// 1. Configuration & Environment Variables
const PORT = process.env.PORT || 3000;
const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Render/Supabase require SSL; a local Postgres for development typically
// doesn't support it at all, so only enable it for non-local hosts.
const dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : '';
const isLocalDb = dbHost === 'localhost' || dbHost === '127.0.0.1';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // While unverified, the connection itself is still encrypted.
  ssl: isLocalDb ? false : { rejectUnauthorized: false }
});

const MIME_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// Serves only files inside PUBLIC_DIR; anything that resolves outside it (or is
// missing) gets a 403/404, never the app's own source, config or dependencies.
function serveStaticFile(pathname, res) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const resolvedPath = path.join(PUBLIC_DIR, relativePath);

  if (resolvedPath !== PUBLIC_DIR && !resolvedPath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(resolvedPath, (error, content) => {
    if (error) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const contentType = MIME_TYPES[path.extname(resolvedPath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
  });
}

// Proxies Giphy so the API key is only ever used server-side, never sent to clients.
async function serveGiphyProxy(pathname, searchParams, res) {
  if (!GIPHY_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Giphy is not configured on this server' }));
  }

  const endpoint = pathname === '/giphy/search' ? 'search' : 'trending';
  const query = searchParams.get('q') || '';
  if (endpoint === 'search' && !query) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'q is required' }));
  }

  const giphyUrl = new URL(`https://api.giphy.com/v1/gifs/${endpoint}`);
  giphyUrl.searchParams.set('api_key', GIPHY_API_KEY);
  giphyUrl.searchParams.set('limit', '20');
  giphyUrl.searchParams.set('rating', 'g');
  if (query) giphyUrl.searchParams.set('q', query);

  try {
    const giphyRes = await fetch(giphyUrl);
    const data = await giphyRes.json();
    res.writeHead(giphyRes.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error('Giphy proxy error:', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Giphy request failed' }));
  }
}

const server = http.createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  const decodedPathname = decodeURIComponent(pathname);

  if (decodedPathname === '/giphy/search' || decodedPathname === '/giphy/trending') {
    serveGiphyProxy(decodedPathname, searchParams, res);
  } else {
    serveStaticFile(decodedPathname, res);
  }
});

const wss = new WebSocketServer({ server });

async function initDB() {
  console.log("Checking/Initializing Database Schema...");
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL
      );
    `);

    // 2. Create Rooms Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
      );
    `);

    // 3. Create Messages Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        room TEXT NOT NULL,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        is_edited BOOLEAN DEFAULT FALSE,
        is_deleted BOOLEAN DEFAULT FALSE
      );
    `);

    // 4. Seed Default 'general' Room
    await client.query(`
      INSERT INTO rooms (name)
      VALUES ('general')
      ON CONFLICT (name) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log("Database initialized successfully.");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error initializing database:", err);
    process.exit(1); // Stop the server if DB setup fails
  } finally {
    client.release();
  }
}

// Start the initialization before the server listens
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Chat server is running on port ${PORT}`);
  });
});

// ----------------- Helpers -----------------

async function getAllRooms() {
  const res = await pool.query('SELECT name FROM rooms ORDER BY name ASC');
  return res.rows.map(r => r.name);
}

function getOnlineUsers() {
  const users = [];
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.user) {
      users.push(client.user.username);
    }
  });
  return [...new Set(users)]; // Deduplicate
}

function broadcastUserList() {
  const msg = JSON.stringify({ type: 'user-list', users: getOnlineUsers() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// Heartbeat function to keep connections alive on Render
function heartbeat() {
  this.isAlive = true;
}

// ----------------- Main Logic -----------------

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat); // Client responds to ping automatically

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const { id, room, content, timestamp, newContent } = msg;
      switch (msg.type) {
          case 'identify':
              if (typeof msg.username !== 'string' || msg.username.trim().length === 0) {
                  return;
              }
              const res = await pool.query(
                'INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO UPDATE SET username=EXCLUDED.username RETURNING *',
                [msg.username.trim()]
              );
              ws.user = res.rows[0];
              ws.send(JSON.stringify({ type: 'identified' }));
              broadcastUserList(); // Update everyone's sidebar
              break;
          case 'join-room':
              ws.currentRoom = msg.room;
              const history = await pool.query(
                'SELECT * FROM messages WHERE room = $1 AND is_deleted = false ORDER BY timestamp ASC LIMIT 50',
                [msg.room]
              );
              ws.send(JSON.stringify({ type: 'history', messages: history.rows }));
              break;
          case 'get-rooms':
              const rooms = await getAllRooms();
              ws.send(JSON.stringify({ type: 'room-list', rooms }));
              break;
          case 'create-room':
              await pool.query('INSERT INTO rooms (name) VALUES ($1) ON CONFLICT DO NOTHING', [msg.room]);
              const updatedRooms = await getAllRooms();
              const roomListMsg = JSON.stringify({ type: 'room-list', rooms: updatedRooms });

              // Broadcast new room list to everyone
              wss.clients.forEach(c => {
                  if (c.readyState === WebSocket.OPEN) c.send(roomListMsg);
              });
              break;
          case 'edit-message': {
              if (!ws.user) return;

              if (typeof newContent !== 'string' || newContent.length === 0 || newContent.length > 5000) {
                  console.warn(`Blocked invalid edit from ${ws.user.username}`);
                  return;
              }
              // Authorize against the identity the server established for this
              // connection, never a username the client claims in the message.
              const editResult = await pool.query(
                    'UPDATE messages SET content = $1, is_edited = true WHERE id = $2 AND username = $3 RETURNING id',
                    [newContent, id, ws.user.username]
                );
              if (editResult.rowCount === 0) return;
              wss.clients.forEach(client => {
                  if (client.readyState === WebSocket.OPEN && client.currentRoom === room) {
                      client.send(JSON.stringify({
                          type: 'message-edited',
                          id,
                          newContent
                      }));
                  }
              });
              break;
          }
          case 'delete-message': {
              if (!ws.user) return;

              const deleteResult = await pool.query(
                    'UPDATE messages SET is_deleted = true WHERE id = $1 AND username = $2 RETURNING id',
                    [id, ws.user.username]
                );
              if (deleteResult.rowCount === 0) return;
              wss.clients.forEach(client => {
                  if (client.readyState === WebSocket.OPEN && client.currentRoom === room) {
                      client.send(JSON.stringify({ type: 'message-deleted', id }));
                  }
              });
              break;
          }
          case 'chat': {
              if (!ws.user) return;

              if (typeof content !== 'string' || content.length === 0 || content.length > 5000) {
                  console.warn(`Blocked invalid message from ${ws.user.username}`);
                  return;
              }
              const username = ws.user.username;
              await pool.query(
                'INSERT INTO messages (id, room, username, content, timestamp) VALUES ($1, $2, $3, $4, $5)',
                [id, room, username, content, new Date(timestamp)]
              );
              // Broadcast message to everyone in the same room
              const outgoing = { type: 'chat', id, room, username, content, timestamp };
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client.currentRoom === room) {
                  client.send(JSON.stringify(outgoing));
                }
              });
              break;
          }

          case 'typing':
          case 'stop-typing':
              if (!ws.user) return;
              wss.clients.forEach(client => {
                  if (client.readyState === WebSocket.OPEN &&
                      client.currentRoom === msg.room &&
                      client.user?.username !== ws.user.username) {
                      // Forward the specific typing state to everyone else in the room
                      client.send(JSON.stringify({
                          type: msg.type === 'typing' ? 'user-typing' : 'user-stop-typing',
                          username: ws.user.username
                      }));
                  }
              });
              break;
      }
    } catch (err) {
      console.error("Server Error:", err);
    }
  });

  ws.on('close', () => {
    // 1. Existing logic to update user list
    broadcastUserList();

    // 2. Clear typing status if they were typing
    if (ws.user && ws.currentRoom) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.currentRoom === ws.currentRoom) {
                client.send(JSON.stringify({
                    type: 'user-stop-typing',
                    username: ws.user.username
                }));
            }
        });
    }
  });
});

// Interval to ping clients every 30s to prevent Render idle timeout
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));
