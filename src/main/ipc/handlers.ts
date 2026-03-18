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

const DEFAULT_PORT = 19876;
let currentPort = DEFAULT_PORT;

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
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
    await startServer(currentPort);
    return { running: true, port: currentPort };
  });
}

export function getPort(): number {
  return currentPort;
}
