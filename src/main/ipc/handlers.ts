import { ipcMain, type BrowserWindow } from 'electron';
import { auditLogger } from '../audit/logger';
import {
  startServer,
  stopServer,
  isServerRunning,
  getActiveConnections,
  onServerEvent,
} from '../server';
import type { ServerStatus } from '../server/types';
import type { SessionManager } from '../session/manager';

const DEFAULT_PORT = 19876;
let currentPort = DEFAULT_PORT;
let sessionMgr: SessionManager;

export function registerIpcHandlers(mainWindow: BrowserWindow, sessionManager: SessionManager): void {
  sessionMgr = sessionManager;

  // Forward server events to renderer
  onServerEvent((event) => {
    mainWindow.webContents.send('server:event', event);
  });

  ipcMain.handle('audit:getEntries', (_event, options?: { offset?: number; limit?: number; search?: string }) => {
    return auditLogger.getEntries(options);
  });

  ipcMain.handle('audit:getEntry', (_event, id: string) => {
    return auditLogger.getEntry(id);
  });

  ipcMain.handle('server:getStatus', (): ServerStatus => {
    return {
      running: isServerRunning(),
      port: currentPort,
      activeConnections: getActiveConnections(),
    };
  });

  ipcMain.handle('server:restart', async (_event, port?: number) => {
    if (port) currentPort = port;
    await stopServer();
    await startServer(currentPort, sessionMgr);
    return { running: true, port: currentPort };
  });

  ipcMain.handle('session:list', (_event, options?: { state?: string; offset?: number; limit?: number }) => {
    return sessionMgr.list(
      (options?.state as 'running' | 'exited' | 'all') ?? 'all',
      options?.offset ?? 0,
      options?.limit ?? 50,
    );
  });

  ipcMain.handle('session:kill', (_event, sessionId: string) => {
    return sessionMgr.kill(sessionId);
  });
}

export function getPort(): number {
  return currentPort;
}
