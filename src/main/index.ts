import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain } from 'electron';
import * as path from 'node:path';
import { startServer, stopServer, isServerRunning } from './server';
import { registerIpcHandlers, getPort } from './ipc/handlers';
import { auditLogger } from './audit/logger';
import { createT, type Locale } from '../i18n';
import { SessionManager } from './session/manager';
import { ManagedClientRuntime } from './managed-client/runtime';
import { ManagedClientMcpWsRuntime, validateManagedClientTlsConfig } from './managed-client/mcp-ws-runtime';
import { registerManagedMcpServerApplyHook } from './managed-client/admin-tools';
import { startManagedClientSignin } from './managed-client/signin';
import { getManagedClientWorkspacePaths } from './managed-client/workspace';
import {
  getBuiltInToolsSecurityConfig,
  getManagedClientMcpServersConfig,
  getManagedClientRuntimeConfig,
  saveBuiltInToolsSecurityConfig,
  saveManagedClientFileConfig,
  saveManagedClientMcpServersConfig,
} from './managed-client/config';
import { parseManagedClientMcpServers, type ManagedClientFileMcpServerConfig } from './managed-client/mcp-server-config';
import { ManagedClientMcpToolRegistry } from './managed-client/mcp-tool-registry';
import type { ManagedClientMode, ManagedClientRuntimeConfig } from './managed-client/types';
import type { BuiltInToolsSecurityConfig } from './builtin-tools/types';

// Handle Squirrel.Windows install/uninstall events inline
// (replaces electron-squirrel-startup to avoid bundling issues)
if (process.platform === 'win32') {
  const cmd = process.argv[1];
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated' || cmd === '--squirrel-uninstall' || cmd === '--squirrel-obsolete') {
    app.quit();
  }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const MCP_REPUBLISH_WAIT_TIMEOUT_MS = 4000;

async function awaitManagedMcpRepublishWithTimeout(
  republishOperation: Promise<{
    applied: boolean;
    toolCount: number;
    tools: string[];
    reason?: 'runtime-inactive' | 'bridge-not-ready';
  }>,
): Promise<{
  applied: boolean;
  toolCount: number;
  tools: string[];
  reason?: 'runtime-inactive' | 'bridge-not-ready' | 'republish-pending';
}> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      republishOperation,
      new Promise<{
        applied: boolean;
        toolCount: number;
        tools: string[];
        reason: 'republish-pending';
      }>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve({
            applied: false,
            toolCount: 0,
            tools: [],
            reason: 'republish-pending',
          });
        }, MCP_REPUBLISH_WAIT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

// Detect system locale for main process
function getMainLocale(): Locale {
  const lang = app.getLocale();
  if (lang.startsWith('zh')) return 'zh-CN';
  return 'en';
}

const t = createT(getMainLocale());

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

function shouldOpenDevTools(): boolean {
  const flag = process.env.CLI_SERVER_OPEN_DEVTOOLS;
  if (!flag) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(flag.toLowerCase());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    title: t('app.title'),
    webPreferences: {
      preload: path.join(__dirname, `preload.js`),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (shouldOpenDevTools()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of quitting
    if (tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(isManagedClientMode: boolean): void {
  // Create a simple 16x16 tray icon
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(t('app.title'));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('tray.show'),
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: isManagedClientMode ? t('tray.managedClientMode') : t('tray.serverRunning', { port: getPort() }),
      enabled: false,
    },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

const sessionManager = new SessionManager();
type ManagedClientRuntimeInstance = ManagedClientRuntime | ManagedClientMcpWsRuntime;

let managedClientRuntime: ManagedClientRuntimeInstance | null = null;
let managedClientConfig = getManagedClientRuntimeConfig(app.getVersion());
let managedClientSessionToken: string | null = null;
let currentMode: 'cli-server' | ManagedClientMode = managedClientConfig.enabled ? managedClientConfig.mode : 'cli-server';
let needsModeSelection = false;
let managedClientSigninPromise: Promise<{ token: string; signinUrl: string }> | null = null;

// Session notification setting
let sessionNotificationEnabled = true;

function buildBootstrapState() {
  const runtimeStatus = managedClientRuntime?.getStatus() as {
    enabled?: boolean;
    running?: boolean;
    clientId?: string | null;
    baseUrl?: string | null;
    pullStatus?: 'idle' | 'waiting' | 'task-assigned' | 'task-completed' | 'task-failed';
    pulledTaskCount?: number;
    emptyPollCount?: number;
    lastPollStatus?: number | null;
    lastTaskCommand?: string | null;
    lastPolledAt?: string | null;
  } | undefined;
  const mcpWsStatus = managedClientRuntime instanceof ManagedClientMcpWsRuntime
    ? managedClientRuntime.getStatus()
    : null;
  const workspacePaths = getManagedClientWorkspacePaths(managedClientConfig.workspaceRoot);

  return {
    mode: currentMode,
    headless: managedClientConfig.headless,
    baseUrl: managedClientConfig.baseUrl,
    signinPageUrl: managedClientConfig.signinPageUrl,
    tlsServername: managedClientConfig.tlsServername,
    tlsCaFile: managedClientConfig.tlsCaFile,
    tlsPinSha256: managedClientConfig.tlsPinSha256,
    workspaceRoot: workspacePaths.rootDir,
    workspaceCurrentDir: workspacePaths.currentDir,
    workspaceArchiveDir: workspacePaths.archiveDir,
    needsModeSelection,
    needsBaseUrl: currentMode !== 'cli-server' && !managedClientConfig.headless && !needsModeSelection && !(runtimeStatus?.running ?? false),
    running: runtimeStatus?.running ?? false,
    pullStatus: runtimeStatus?.pullStatus ?? 'idle',
    pulledTaskCount: runtimeStatus?.pulledTaskCount ?? 0,
    emptyPollCount: runtimeStatus?.emptyPollCount ?? 0,
    lastPollStatus: runtimeStatus?.lastPollStatus ?? null,
    lastTaskCommand: runtimeStatus?.lastTaskCommand ?? null,
    lastPolledAt: runtimeStatus?.lastPolledAt ?? null,
    receivedEventCount: mcpWsStatus?.receivedEventCount ?? 0,
    pingCount: mcpWsStatus?.pingCount ?? 0,
    pongSentCount: mcpWsStatus?.pongSentCount ?? 0,
    lastEventAt: mcpWsStatus?.lastEventAt ?? null,
    lastEventName: mcpWsStatus?.lastEventName ?? null,
    lastPingAt: mcpWsStatus?.lastPingAt ?? null,
  };
}

function createManagedClientRuntime(config: ManagedClientRuntimeConfig): ManagedClientRuntimeInstance {
  if (config.mode === 'managed-client-mcp-ws') {
    return new ManagedClientMcpWsRuntime(config, sessionManager);
  }

  return new ManagedClientRuntime(config, sessionManager);
}

async function ensureServerStarted(): Promise<void> {
  if (isServerRunning()) {
    return;
  }

  await startServer(getPort(), sessionManager);
}

function refreshTray(): void {
  if (!tray) {
    return;
  }

  tray.destroy();
  tray = null;
  createTray(currentMode !== 'cli-server');
}

app.whenReady().then(async () => {
  managedClientConfig = getManagedClientRuntimeConfig(app.getVersion());
  currentMode = managedClientConfig.enabled ? managedClientConfig.mode : 'cli-server';
  needsModeSelection = !managedClientConfig.headless;
  registerManagedMcpServerApplyHook(async () => {
    managedClientConfig = {
      ...getManagedClientRuntimeConfig(app.getVersion()),
      token: managedClientSessionToken,
    };

    if (!(managedClientRuntime instanceof ManagedClientMcpWsRuntime)) {
      return {
        applied: false,
        toolCount: 0,
        tools: [],
        reason: 'runtime-inactive' as const,
      };
    }

    return managedClientRuntime.updateMcpServers(managedClientConfig.mcpServers);
  });

  // Initialize audit logger
  auditLogger.init();

  // IPC for notification setting
  ipcMain.handle('settings:getNotification', () => sessionNotificationEnabled);
  ipcMain.handle('settings:setNotification', (_e, enabled: boolean) => {
    sessionNotificationEnabled = enabled;
    return sessionNotificationEnabled;
  });
  ipcMain.handle('managed-client:getBootstrapState', () => buildBootstrapState());
  ipcMain.handle('managed-client:validateTls', async (_e, payload: {
    baseUrl: string;
    tlsServername?: string | null;
    tlsCaFile?: string | null;
    tlsPinSha256?: string | null;
  }) => validateManagedClientTlsConfig({
    baseUrl: payload.baseUrl,
    tlsServername: payload.tlsServername ?? null,
    tlsCaFile: payload.tlsCaFile ?? null,
    tlsPinSha256: payload.tlsPinSha256 ?? null,
  }));
  ipcMain.handle('managed-client:getMcpServersConfig', () => ({
    mcpServers: getManagedClientMcpServersConfig(),
  }));
  ipcMain.handle('built-in-tools:getSecurityConfig', () => ({
    config: getBuiltInToolsSecurityConfig(),
  }));
  ipcMain.handle('built-in-tools:saveSecurityConfig', async (_e, payload: { config: BuiltInToolsSecurityConfig }) => {
    saveBuiltInToolsSecurityConfig(payload.config);
    managedClientConfig = {
      ...getManagedClientRuntimeConfig(app.getVersion()),
      token: managedClientSessionToken,
    };

    let applied = false;
    let toolCount = 0;
    let tools: string[] = [];
    let reason: 'runtime-inactive' | 'bridge-not-ready' | 'republish-pending' | undefined;

    if (managedClientRuntime instanceof ManagedClientMcpWsRuntime) {
      const result = await awaitManagedMcpRepublishWithTimeout(
        managedClientRuntime.updateMcpServers(managedClientConfig.mcpServers),
      );
      applied = result.applied;
      toolCount = result.toolCount;
      tools = result.tools;
      reason = result.reason;
    }

    return {
      saved: true,
      config: getBuiltInToolsSecurityConfig(),
      applied,
      toolCount,
      tools,
      reason,
    };
  });
  ipcMain.handle('managed-client:testMcpServersConfig', async (_e, payload: { mcpServers: Record<string, ManagedClientFileMcpServerConfig> }) => {
    const externalServers = parseManagedClientMcpServers(payload.mcpServers);
    const results = await ManagedClientMcpToolRegistry.testExternalServers({
      externalServerConfigs: externalServers,
      version: app.getVersion(),
    });
    return { results };
  });
  ipcMain.handle('managed-client:saveMcpServersConfig', async (_e, payload: {
    mcpServers: Record<string, ManagedClientFileMcpServerConfig>;
    apply?: boolean;
  }) => {
    saveManagedClientMcpServersConfig(payload.mcpServers);
    managedClientConfig = {
      ...getManagedClientRuntimeConfig(app.getVersion()),
      token: managedClientSessionToken,
    };

    let applied = false;
    let toolCount = 0;
    let tools: string[] = [];

    const shouldApply = payload.apply !== false;

    if (shouldApply && managedClientRuntime instanceof ManagedClientMcpWsRuntime) {
      const result = await managedClientRuntime.updateMcpServers(managedClientConfig.mcpServers);
      applied = result.applied;
      toolCount = result.toolCount;
      tools = result.tools;
    }

    return {
      saved: true,
      applied,
      toolCount,
      tools,
    };
  });
  ipcMain.handle('managed-client:refreshMcpTools', async () => {
    managedClientConfig = {
      ...getManagedClientRuntimeConfig(app.getVersion()),
      token: managedClientSessionToken,
    };

    if (!(managedClientRuntime instanceof ManagedClientMcpWsRuntime)) {
      return {
        applied: false,
        toolCount: 0,
        tools: [],
      };
    }

    return managedClientRuntime.updateMcpServers(managedClientConfig.mcpServers);
  });
  ipcMain.handle('managed-client:selectMode', async (_e, mode: 'cli-server' | ManagedClientMode) => {
    managedClientRuntime?.stop();
    managedClientRuntime = null;
    await stopServer();

    saveManagedClientFileConfig({
      enabled: mode !== 'cli-server',
      mode: mode === 'cli-server' ? undefined : mode,
    });
    managedClientConfig = getManagedClientRuntimeConfig(app.getVersion());
    managedClientSessionToken = null;
    currentMode = managedClientConfig.enabled ? managedClientConfig.mode : 'cli-server';
    needsModeSelection = false;

    if (mode === 'cli-server') {
      await ensureServerStarted();
    }

    refreshTray();
    return buildBootstrapState();
  });
  ipcMain.handle('managed-client:saveBaseUrlAndStart', async (_e, payload: {
    baseUrl: string;
    signinPageUrl?: string | null;
    tlsServername?: string | null;
    tlsCaFile?: string | null;
    tlsPinSha256?: string | null;
    token?: string | null;
  }) => {
    const normalizedToken = payload.token?.trim();
    const normalizedSigninPageUrl = payload.signinPageUrl?.trim();
    const normalizedTlsServername = payload.tlsServername?.trim();
    const normalizedTlsCaFile = payload.tlsCaFile?.trim();
    const normalizedTlsPinSha256 = payload.tlsPinSha256?.trim();

    managedClientRuntime?.stop();
    managedClientRuntime = null;

    saveManagedClientFileConfig({
      bootstrapBaseUrl: payload.baseUrl,
      signinPageUrl: normalizedSigninPageUrl ? normalizedSigninPageUrl : undefined,
      tlsServername: normalizedTlsServername ? normalizedTlsServername : undefined,
      tlsCaFile: normalizedTlsCaFile ? normalizedTlsCaFile : undefined,
      tlsPinSha256: normalizedTlsPinSha256 ? normalizedTlsPinSha256 : undefined,
      token: undefined,
    });
    managedClientSessionToken = normalizedToken ? normalizedToken : null;
    managedClientConfig = {
      ...getManagedClientRuntimeConfig(app.getVersion()),
      token: managedClientSessionToken,
    };
    currentMode = managedClientConfig.enabled ? managedClientConfig.mode : 'cli-server';
    needsModeSelection = false;

    if (managedClientConfig.enabled) {
      managedClientRuntime = createManagedClientRuntime(managedClientConfig);
      managedClientRuntime.start();
    }

    refreshTray();
    return buildBootstrapState();
  });
  ipcMain.handle('managed-client:signOut', async () => {
    managedClientRuntime?.stop();
    managedClientRuntime = null;
    managedClientSessionToken = null;
    managedClientConfig = {
      ...getManagedClientRuntimeConfig(app.getVersion()),
      token: null,
    };
    currentMode = managedClientConfig.enabled ? managedClientConfig.mode : 'cli-server';
    needsModeSelection = false;

    refreshTray();
    return buildBootstrapState();
  });
  ipcMain.handle('managed-client:startSignin', async (_e, payload?: { signinPageUrl?: string | null; baseUrl?: string | null }) => {
    if (managedClientSigninPromise) {
      return managedClientSigninPromise;
    }

    managedClientSigninPromise = startManagedClientSignin(payload).finally(() => {
      managedClientSigninPromise = null;
    });

    return managedClientSigninPromise;
  });

  if (!managedClientConfig.headless) {
    // Create the browser window
    createWindow();
  }

  // Register IPC handlers
  if (mainWindow) {
    registerIpcHandlers(mainWindow, sessionManager, () => sessionNotificationEnabled);
  }

  if (!managedClientConfig.headless && currentMode === 'cli-server' && !needsModeSelection) {
    // Start the embedded server
    try {
      await startServer(getPort(), sessionManager);
      console.log(`Server started on port ${getPort()}`);
    } catch (err) {
      console.error('Failed to start server:', err);
    }
  }

  if (!managedClientConfig.headless) {
    // Create system tray
    createTray(currentMode !== 'cli-server');
  }

  if (managedClientConfig.enabled) {
    try {
      if (managedClientConfig.headless && managedClientConfig.baseUrl) {
        managedClientRuntime = createManagedClientRuntime(managedClientConfig);
        managedClientRuntime.start();
        console.log(`Managed client runtime enabled (${managedClientConfig.mode})`);
      } else if (!managedClientConfig.headless) {
        console.log('Managed client runtime waiting for UI bootstrap configuration');
      } else {
        throw new Error('Managed client runtime requires MANAGED_CLIENT_BASE_URL');
      }
    } catch (err) {
      console.error('Failed to start managed client runtime:', err);
      if (managedClientConfig.headless) {
        app.quit();
      }
    }
  } else if (managedClientConfig.headless) {
    console.error('Managed client headless mode requires --enable-managed-client-runtime or ENABLE_MANAGED_CLIENT_RUNTIME=true');
    app.quit();
  }
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit — server should keep running (tray icon)
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
    if (mainWindow) {
      registerIpcHandlers(mainWindow, sessionManager, () => sessionNotificationEnabled);
    }
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  managedClientRuntime?.stop();
});
