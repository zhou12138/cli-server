import { contextBridge, ipcRenderer } from 'electron';

export interface IOEvent {
  stream: 'stdin' | 'stdout' | 'stderr';
  time: number;
  data: string;
}

export interface ElectronAPI {
  getAuditEntries: (options?: { offset?: number; limit?: number; search?: string }) => Promise<{
    entries: Array<{
      id: string;
      timestamp: string;
      command: string;
      cwd: string;
      exitCode: number | null;
      signal: string | null;
      stdout: string;
      stderr: string;
      ioEvents?: IOEvent[];
      durationMs: number;
      clientIp: string;
    }>;
    total: number;
  }>;
  getAuditEntry: (id: string) => Promise<{
    id: string;
    timestamp: string;
    command: string;
    cwd: string;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    ioEvents?: IOEvent[];
    durationMs: number;
    clientIp: string;
  } | undefined>;
  getServerStatus: () => Promise<{ running: boolean; port: number; activeConnections: number }>;
  restartServer: (port?: number) => Promise<{ running: boolean; port: number }>;
  getSessions: (options?: { state?: string; offset?: number; limit?: number }) => Promise<{
    offset: number; limit: number; total: number; nextOffset: number | null;
    data: Array<{
      sessionId: string; command: string; cwd: string; pid: number;
      state: string; exitCode: number | null; signal: string | null;
      startedAt: string; endedAt: string | null; durationMs: number;
      stdoutLength: number; stderrLength: number; clientIp: string;
    }>;
  }>;
  killSession: (sessionId: string) => Promise<{ success: boolean }>;
  readSessionOutput: (sessionId: string, stream: 'stdout' | 'stderr', offset?: number, limit?: number) => Promise<{
    offset: number; limit: number; total: number; nextOffset: number | null; data: string;
  }>;
  readSessionIOLog: (sessionId: string) => Promise<IOEvent[]>;
  clearAuditLog: () => Promise<{ success: boolean }>;
  getNotificationEnabled: () => Promise<boolean>;
  setNotificationEnabled: (enabled: boolean) => Promise<boolean>;
  onServerEvent: (callback: (event: { type: string; data?: unknown }) => void) => () => void;
}

const api: ElectronAPI = {
  getAuditEntries: (options) => ipcRenderer.invoke('audit:getEntries', options),
  getAuditEntry: (id) => ipcRenderer.invoke('audit:getEntry', id),
  getServerStatus: () => ipcRenderer.invoke('server:getStatus'),
  restartServer: (port) => ipcRenderer.invoke('server:restart', port),
  getSessions: (options) => ipcRenderer.invoke('session:list', options),
  killSession: (sessionId) => ipcRenderer.invoke('session:kill', sessionId),
  readSessionOutput: (sessionId, stream, offset, limit) => ipcRenderer.invoke('session:readOutput', sessionId, stream, offset, limit),
  readSessionIOLog: (sessionId) => ipcRenderer.invoke('session:readIOLog', sessionId),
  clearAuditLog: () => ipcRenderer.invoke('audit:clear'),
  getNotificationEnabled: () => ipcRenderer.invoke('settings:getNotification'),
  setNotificationEnabled: (enabled) => ipcRenderer.invoke('settings:setNotification', enabled),
  onServerEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: string; data?: unknown }) => callback(data);
    ipcRenderer.on('server:event', handler);
    return () => ipcRenderer.removeListener('server:event', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
