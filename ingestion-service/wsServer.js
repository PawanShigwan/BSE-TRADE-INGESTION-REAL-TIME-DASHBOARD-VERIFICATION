/**
 * WebSocket Server Manager
 * Handles real-time event broadcasting to the Trades Dashboard.
 * Enables zero-polling, zero-cron real-time updates.
 */

const { WebSocketServer, WebSocket } = require('ws');

class WsManager {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  init(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);
      const clientIp = req.socket.remoteAddress;
      console.log(`[WebSocket] Client connected from ${clientIp}. Total clients: ${this.clients.size}`);

      // Send initial handshake
      ws.send(JSON.stringify({
        type: 'CONNECTED',
        payload: {
          message: 'Connected to BSE Live Trade Stream',
          connectedAt: new Date().toISOString()
        }
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] Client disconnected. Total clients: ${this.clients.size}`);
      });

      ws.on('error', (err) => {
        console.error(`[WebSocket] Client error: ${err.message}`);
        this.clients.delete(ws);
      });
    });

    console.log('[WebSocket] Server initialized on path /ws');
  }

  /**
   * Broadcast message to all connected clients
   * @param {string} type Event type
   * @param {Object} payload Event data
   */
  broadcast(type, payload) {
    if (!this.wss) return;

    const message = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString()
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (err) {
          console.error(`[WebSocket] Error sending message to client: ${err.message}`);
        }
      }
    }
  }
}

module.exports = new WsManager();
