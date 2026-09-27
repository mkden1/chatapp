const { contextBridge, ipcRenderer } = require('electron');

// Resolved once, synchronously, before the page's own scripts run.
const httpBase = ipcRenderer.sendSync('get-http-base-sync');

let connected = false;

ipcRenderer.on('connection-status', (event, status) => {
  connected = (status === 'Connected');
});

contextBridge.exposeInMainWorld('chatAPI', {
  httpBase,
  sendMessage: (message) => ipcRenderer.send('send-message', message),

  onMessage: (callback) =>
    ipcRenderer.on('receive-message', (event, data) => callback(data)),

  onStatus: (callback) =>
    ipcRenderer.on('connection-status', (event, status) => callback(status)),

  isConnected: () => connected
});
