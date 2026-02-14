const { contextBridge, ipcRenderer } = require('electron');

let connected = false;

ipcRenderer.on('connection-status', (event, status) => {
  connected = (status === 'Connected');
});

contextBridge.exposeInMainWorld('chatAPI', {
  sendMessage: (message) => ipcRenderer.send('send-message', message),

  onMessage: (callback) =>
    ipcRenderer.on('receive-message', (event, data) => callback(data)),

  onStatus: (callback) =>
    ipcRenderer.on('connection-status', (event, status) => callback(status)),

  isConnected: () => connected
});
