import { contextBridge, ipcRenderer } from 'electron';

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
    durationMs: number;
    clientIp: string;
  } | undefined>;
  getServerStatus: () => Promise<{ running: boolean; port: number; activeConnections: number }>;
  restartServer: (port?: number) => Promise<{ running: boolean; port: number }>;
  onServerEvent: (callback: (event: { type: string; data?: unknown }) => void) => () => void;
}

const api: ElectronAPI = {
  getAuditEntries: (options) => ipcRenderer.invoke('audit:getEntries', options),
  getAuditEntry: (id) => ipcRenderer.invoke('audit:getEntry', id),
  getServerStatus: () => ipcRenderer.invoke('server:getStatus'),
  restartServer: (port) => ipcRenderer.invoke('server:restart', port),
  onServerEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: string; data?: unknown }) => callback(data);
    ipcRenderer.on('server:event', handler);
    return () => ipcRenderer.removeListener('server:event', handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
