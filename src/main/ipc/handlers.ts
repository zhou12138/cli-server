import { ipcMain, Notification, type BrowserWindow } from 'electron';
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

export function registerIpcHandlers(mainWindow: BrowserWindow, sessionManager: SessionManager, getNotificationEnabled: () => boolean): void {
  sessionMgr = sessionManager;

  // Forward server events to renderer
  onServerEvent((event) => {
    mainWindow.webContents.send('server:event', event);

    // Show system notification on new session creation
    if (event.type === 'session:created' && getNotificationEnabled()) {
      const data = event.data as { command?: string; clientIp?: string } | undefined;
      const cmd = data?.command ?? 'unknown';
      const truncated = cmd.length > 200 ? cmd.slice(0, 200) + '...' : cmd;
      new Notification({
        title: 'New Session',
        body: `> ${truncated}`,
      }).show();
    }
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
    try {
      sessionMgr.kill(sessionId);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('session:readOutput', (_event, sessionId: string, stream: 'stdout' | 'stderr', offset?: number, limit?: number) => {
    try {
      return sessionMgr.readOutput(sessionId, stream, offset ?? 0, limit ?? 4096);
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('session:readIOLog', (_event, sessionId: string) => {
    try {
      return sessionMgr.readIOLog(sessionId);
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('audit:clear', () => {
    auditLogger.clear();
    sessionMgr.clearExited();
    return { success: true };
  });
}

export function getPort(): number {
  return currentPort;
}
