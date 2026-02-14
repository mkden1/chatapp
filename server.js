import { WebSocketServer } from 'ws';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const pool = new Pool({
  user: 'postgres', host: 'localhost', database: 'chatapp', password: 'mkden', port: 5432,
});

const wss = new WebSocketServer({ port: 3000 });
console.log("Server running on ws://localhost:3000");

// --- HELPER FUNCTIONS (The fix for your error) ---
async function getRoomByName(name) {
  const res = await pool.query('SELECT * FROM rooms WHERE name=$1', [name]);
  return res.rows[0];
}

async function getOrCreateRoom(name) {
  const res = await pool.query(
    'INSERT INTO rooms (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING *',
    [name]
  );
  return res.rows[0];
}

async function getAllRooms() {
  const res = await pool.query('SELECT name FROM rooms ORDER BY name ASC');
  return res.rows.map(r => r.name);
}


function getOnlineUsers() {
  const users = [];
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.user) {
      users.push(client.user.username);
    }
  });
  // Remove duplicates (in case one user has two tabs open)
  return [...new Set(users)];
}

function broadcastUserList() {
  const userList = getOnlineUsers();
  const msg = JSON.stringify({ type: 'user-list', users: userList });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'identify') {
      const res = await pool.query(
        'INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO UPDATE SET username=EXCLUDED.username RETURNING *',
        [msg.username]
      );
      ws.user = res.rows[0];
      ws.send(JSON.stringify({ type: 'identified' }));

      broadcastUserList();

      const rooms = await getAllRooms();
      ws.send(JSON.stringify({ type: 'room-list', rooms }));
    }

    if (msg.type === 'create-room') {
        // 1. Save to DB
        await pool.query('INSERT INTO rooms (name) VALUES ($1) ON CONFLICT DO NOTHING', [msg.room]);
        
        // 2. Get the updated list
        const rooms = await getAllRooms(); // Use your helper to get all room names
        const updateMsg = JSON.stringify({ type: 'room-list', rooms });

        // 3. Broadcast to EVERYONE connected
        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(updateMsg);
            }
        });
    }

    if (msg.type === 'join-room') {
        if (!ws.user) return;
        const room = await getOrCreateRoom(msg.room);
        ws.currentRoom = room.name;

        // FIX: Grab the LATEST 50, then sort them ASC for the UI
        const historyRes = await pool.query(
        `SELECT * FROM (
            SELECT m.id, u.username, m.content, m.timestamp 
            FROM messages m 
            JOIN users u ON m.sender_id = u.id 
            WHERE m.room_id = $1 
            ORDER BY m.timestamp DESC 
            LIMIT 50
        ) sub ORDER BY timestamp ASC`,
        [room.id]
        );

        ws.send(JSON.stringify({
            type: 'history',
            room: room.name,
            messages: historyRes.rows.map(r => ({
                type: 'chat',
                id: r.id,
                room: room.name,
                username: r.username,
                content: r.content,
                timestamp: Number(r.timestamp)
            }))
        }));
    }

    if (msg.type === 'chat') {
        if (!ws.user || !ws.currentRoom) return;
        const room = await getRoomByName(ws.currentRoom);
        
        const messageId = msg.id || uuidv4();
        const timestamp = Date.now();

        // res.rowCount will be 1 if it's new, 0 if it already exists
        const res = await pool.query(
            'INSERT INTO messages (id, room_id, sender_id, content, timestamp) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
            [messageId, room.id, ws.user.id, msg.content, timestamp]
        );

        const broadcastMsg = JSON.stringify({
            type: 'chat', id: messageId, room: room.name, username: ws.user.username, content: msg.content, timestamp
        });

        if (res.rowCount > 0) {
            // NEW MESSAGE: Broadcast to everyone in the room
            wss.clients.forEach(client => {
            if (client.readyState === 1 && client.currentRoom === room.name) {
                client.send(broadcastMsg);
            }
            });
        } else {
            // DUPLICATE/RETRY: Only send back to the sender so their UI clears "pending"
            ws.send(broadcastMsg);
        }
    }
  });

  ws.on('close', () => {
    console.log("User disconnected");
    broadcastUserList();
  });
});