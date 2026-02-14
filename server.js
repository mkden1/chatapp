const { WebSocketServer, WebSocket } = require('ws');
const { Pool } = require('pg');
const http = require('http');

// 1. Configuration & Environment Variables
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // Required for Render/Supabase. While unverified, it's encrypted.
    rejectUnauthorized: false 
  }
});

// Create an HTTP server to wrap the WebSocket server (best practice for Cloud)
const server = http.createServer();
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
        timestamp TIMESTAMPTZ NOT NULL
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

      if (msg.type === 'identify') {
        // Upsert user into DB
        const res = await pool.query(
          'INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO UPDATE SET username=EXCLUDED.username RETURNING *',
          [msg.username]
        );
        ws.user = res.rows[0];
        ws.send(JSON.stringify({ type: 'identified' }));
        broadcastUserList(); // Update everyone's sidebar
      }

      if (msg.type === 'get-rooms') {
        const rooms = await getAllRooms();
        ws.send(JSON.stringify({ type: 'room-list', rooms }));
      }

      if (msg.type === 'create-room') {
        await pool.query('INSERT INTO rooms (name) VALUES ($1) ON CONFLICT DO NOTHING', [msg.room]);
        const rooms = await getAllRooms();
        // Broadcast new room list to everyone
        wss.clients.forEach(c => c.send(JSON.stringify({ type: 'room-list', rooms })));
      }

      if (msg.type === 'join-room') {
        ws.currentRoom = msg.room;
        const history = await pool.query(
          'SELECT * FROM messages WHERE room = $1 ORDER BY timestamp ASC LIMIT 50',
          [msg.room]
        );
        ws.send(JSON.stringify({ type: 'history', messages: history.rows }));
      }

      if (msg.type === 'chat') {
        const { id, room, username, content, timestamp } = msg;
        await pool.query(
          'INSERT INTO messages (id, room, username, content, timestamp) VALUES ($1, $2, $3, $4, $5)',
          [id, room, username, content, new Date(timestamp)]
        );
        // Broadcast message to everyone in the same room
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client.currentRoom === room) {
            client.send(JSON.stringify(msg));
          }
        });
      }
    } catch (err) {
      console.error("Server Error:", err);
    }
  });

  ws.on('close', () => {
    broadcastUserList(); // Update online list when someone leaves
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

