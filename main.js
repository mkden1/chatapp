const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { app, BrowserWindow, ipcMain } = require('electron');
const WebSocket = require('ws');
const { resolveServerUrls } = require('./serverUrl');

const { wsUrl: SERVER_WS_URL, httpBase: SERVER_HTTP_BASE } = resolveServerUrls(process.env.DESKTOP_SERVER_URL);

if (process.argv.includes('--instance=2')) {
  app.setPath('userData', app.getPath('userData') + '-2');
}

let win;
let ws;
let username = null;

let rendererReady = false;

// ---------------- Queues for messages/status before renderer ready ----------------
const queuedMessages = [];
const queuedStatuses = [];

// ---------------- Create Window ----------------
function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('public/index.html');

  win.webContents.once('did-finish-load', () => {
    console.log("Renderer ready");
    rendererReady = true;

    // Flush queued messages/statuses
    queuedStatuses.forEach(status => win.webContents.send('connection-status', status));
    queuedMessages.forEach(msg => win.webContents.send('receive-message', msg));

    queuedStatuses.length = 0;
    queuedMessages.length = 0;

    // Re-identify after renderer is ready
    if (username) {
      sendWebSocketMessage({ type: 'identify', username });
    }
  });
}

// ---------------- IPC ----------------
ipcMain.on('send-message', (event, messageObject) => {
  sendWebSocketMessage(messageObject);
});

ipcMain.on('get-http-base-sync', (event) => {
  event.returnValue = SERVER_HTTP_BASE;
});

// ---------------- Send to Renderer ----------------
function sendToRenderer(channel, payload) {
  if (rendererReady && win && win.webContents) {
    win.webContents.send(channel, payload);
  } else {
    // Queue messages until renderer ready
    if (channel === 'receive-message') queuedMessages.push(payload);
    if (channel === 'connection-status') queuedStatuses.push(payload);
  }
}

// ---------------- WebSocket ----------------
const RECONNECT_INTERVAL = 2000;
let reconnectTimeout = null;

function connectWebSocket() {
  ws = new WebSocket(SERVER_WS_URL);

  ws.on('open', () => {
    console.log("WS OPEN");
    sendToRenderer('connection-status', 'Connected');

    // Re-identify if we already have a username
    if (username) {
      sendWebSocketMessage({ type: 'identify', username });
    }
  });

  ws.on('close', () => {
    console.log("WS CLOSED");
    sendToRenderer('connection-status', 'Disconnected');

    // Reconnect after interval
    reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_INTERVAL);
  });

  ws.on('error', (err) => {
    console.error("WS ERROR:", err);
    if (ws.readyState !== WebSocket.CLOSED) ws.close();
  });

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      console.log("Forwarding to renderer:", parsed);
      sendToRenderer('receive-message', parsed);
    } catch (e) {
      console.error("Failed to parse WS message:", e);
    }
  });
}

// ---------------- Helper ----------------
function sendWebSocketMessage(msg) {
  if (msg.type === 'identify') username = msg.username;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    console.log("WS not connected, message queued:", msg);
    // Only queue if renderer isn't ready yet
    if (!rendererReady) {
      if (msg.type === 'connection-status') queuedStatuses.push(msg);
      else queuedMessages.push(msg);
    }
  }
}

// ---------------- App Lifecycle ----------------
app.whenReady().then(() => {
  createWindow();
  connectWebSocket();
});
