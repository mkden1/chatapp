const DEFAULT_WS_URL = 'ws://localhost:3000';

// Derives the matching http(s) base (for the Giphy proxy) from the WebSocket
// URL, so there's one place the desktop client's server address is defined.
function resolveServerUrls(rawWsUrl) {
  const wsUrl = rawWsUrl || DEFAULT_WS_URL;
  const httpBase = wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  return { wsUrl, httpBase };
}

module.exports = { resolveServerUrls, DEFAULT_WS_URL };
