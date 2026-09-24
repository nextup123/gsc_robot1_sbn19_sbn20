// backend/ws/BatchWSServer.js
import { WebSocketServer } from 'ws';

export class BatchWSServer {
  constructor(server, batchInterval = 50) { // 50ms batch window
    this.wss = new WebSocketServer({ server });
    this.clients = new Set();
    this.pendingMessages = new Map(); // client -> array of messages
    this.batchInterval = batchInterval;
    this.batchTimer = null;
    
    this.init();
  }

  init() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      
      // Initialize batch queue for this client
      this.pendingMessages.set(ws, []);
      
      ws.on('close', () => {
        this.clients.delete(ws);
        this.pendingMessages.delete(ws);
      });
    });
    
    // Start batching loop
    this.startBatching();
  }
  
  startBatching() {
    this.batchTimer = setInterval(() => {
      if (this.clients.size === 0) return;
      
      for (const [client, messages] of this.pendingMessages) {
        if (messages.length === 0) continue;
        if (client.readyState === 1) {
          // Send all messages as array (reduce syscalls)
          client.send(JSON.stringify(messages));
          messages.length = 0; // Clear array without reallocating
        }
      }
    }, this.batchInterval);
  }
  
  broadcast(msg) {
    // Skip if no clients
    if (this.clients.size === 0) return;
    
    // Single message optimization
    const data = JSON.stringify(msg);
    
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }
  
  batchBroadcast(msg) {
    // For high-frequency messages, batch them
    if (this.clients.size === 0) return;
    
    for (const client of this.clients) {
      if (client.readyState === 1) {
        this.pendingMessages.get(client).push(msg);
      }
    }
  }
  
  sendTo(ws, msg) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }
  
  close() {
    if (this.batchTimer) clearInterval(this.batchTimer);
    for (const client of this.clients) {
      client.close();
    }
    this.wss.close();
  }
}