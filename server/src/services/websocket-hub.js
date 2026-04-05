/**
 * WebSocket Hub — central message broker
 * Manages all connected browser clients and broadcasts events
 */
export class WebSocketHub {
  constructor() {
    this.clients = new Set();
  }

  addClient(socket) {
    this.clients.add(socket);
    console.log(`[WSHub] Client connected (${this.clients.size} total)`);

    // Send current state on connect
    this.send(socket, {
      type: 'connected',
      clients: this.clients.size,
      timestamp: new Date().toISOString(),
    });
  }

  removeClient(socket) {
    this.clients.delete(socket);
    console.log(`[WSHub] Client disconnected (${this.clients.size} total)`);
  }

  /** Send to one client */
  send(socket, data) {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(data));
    }
  }

  /** Broadcast to all connected clients */
  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(msg);
      }
    }
  }

  /** Broadcast on a specific channel */
  broadcastChannel(channel, data) {
    this.broadcast({ channel, ...data, timestamp: new Date().toISOString() });
  }
}
