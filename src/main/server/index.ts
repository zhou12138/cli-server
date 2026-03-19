import express from 'express';
import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { createHttpRoutes } from './http-routes';
import { handleWebSocketConnection } from './ws-handler';
import { mountMcpEndpoints } from '../mcp/server';
import type { SessionManager } from '../session/manager';

let httpServer: Server | null = null;
let wss: WebSocketServer | null = null;
let activeConnections = 0;

export type ServerEventCallback = (event: { type: string; data?: unknown }) => void;
let eventCallback: ServerEventCallback | null = null;

export function onServerEvent(cb: ServerEventCallback): void {
  eventCallback = cb;
}

export function emitServerEvent(type: string, data?: unknown): void {
  eventCallback?.({ type, data });
}

function emit(type: string, data?: unknown): void {
  emitServerEvent(type, data);
}

export function getActiveConnections(): number {
  return activeConnections;
}

export function startServer(port: number, sessionManager: SessionManager): Promise<void> {
  return new Promise((resolve, reject) => {
    if (httpServer) {
      reject(new Error('Server already running'));
      return;
    }

    const app = express();

    // CORS middleware — allow all origins for MVP
    app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      next();
    });

    // JSON body parser for MCP POST endpoint
    app.use(express.json());

    app.use(createHttpRoutes());

    // Mount MCP SSE endpoints
    mountMcpEndpoints(app, sessionManager);

    httpServer = createServer(app);
    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws, req) => {
      activeConnections++;
      const clientIp = req.socket.remoteAddress || 'unknown';
      emit('connection', { activeConnections, clientIp });

      handleWebSocketConnection(ws, clientIp);

      ws.on('close', () => {
        activeConnections--;
        emit('disconnection', { activeConnections });
      });
    });

    httpServer.listen(port, () => {
      emit('started', { port });
      resolve();
    });

    httpServer.on('error', (err) => {
      httpServer = null;
      wss = null;
      reject(err);
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (wss) {
      // Close all active WebSocket connections
      for (const client of wss.clients) {
        client.close();
      }
      wss.close();
      wss = null;
    }
    if (httpServer) {
      httpServer.close(() => {
        httpServer = null;
        emit('stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export function isServerRunning(): boolean {
  return httpServer !== null && httpServer.listening;
}
