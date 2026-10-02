'use strict';

// This unauthenticated research UI is local-only, including WebSocket upgrades.
function isLocalRequest(request) {
  const headers = request.headers || {};
  const port = request.socket && request.socket.localPort;
  const host = headers.host;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!port || !allowedHosts.has(host)) return false;
  if (headers.origin !== undefined && headers.origin !== `http://${host}`) return false;
  return headers['sec-fetch-site'] === undefined ||
    ['same-origin', 'none'].includes(headers['sec-fetch-site']);
}

module.exports = { isLocalRequest };
