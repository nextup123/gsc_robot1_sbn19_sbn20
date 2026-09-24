// ws/wsServer.js

import { WebSocketServer } from "ws";

class WSServer {
  constructor(server) {
    this.wss = new WebSocketServer({ server }); // ✅ attach to existing HTTP server
    this.clients = new Set();
    this.messageHandler = null;

    this.init();
  }

  init() {
    this.wss.on("connection", (ws) => {
      console.log("WS Client connected");
      this.clients.add(ws);

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data);

          if (this.messageHandler) {
            this.messageHandler(msg, ws);
          }
        } catch (err) {
          console.error("Invalid WS message:", err.message);
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log("WS Client disconnected");
      });
    });
  }

  setMessageHandler(handler) {
    this.messageHandler = handler;
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);

    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }
  close() {
    for (const client of this.clients) {
      client.close();
    }

    this.wss.close(() => {
      console.log("WSS closed");
    });
  }
  sendTo(ws, msg) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }
}

export default WSServer;
