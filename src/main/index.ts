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
  getManagedClientWorkspaceRoot,
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

async function stopManagedClientRuntime(): Promise<void> {
  const runtime = managedClientRuntime;
  if (!runtime) {
    return;
  }

  managedClientRuntime = null;
  await runtime.stopAndWait();
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function firstStringClaim(payload: Record<string, unknown> | null, keys: string[]): string | null {
  if (!payload) {
    return null;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getManagedClientSessionIdentity(token: string | null): {
  label: string | null;
  detail: string | null;
} {
  const normalizedToken = token?.trim();
  if (!normalizedToken) {
    return {
      label: null,
      detail: null,
    };
  }

  const payload = decodeJwtPayload(normalizedToken);
  const username = firstStringClaim(payload, ['preferred_username', 'email', 'upn']);
  const displayName = firstStringClaim(payload, ['name', 'given_name']);
  const subject = firstStringClaim(payload, ['sub']);

  if (username) {
    return {
      label: username,
      detail: displayName && displayName !== username ? displayName : null,
    };
  }

  if (displayName) {
    return {
      label: displayName,
      detail: subject && subject !== displayName ? subject : null,
    };
  }

  return {
    label: subject,
    detail: null,
  };
}

function canClearAuditHistory(): boolean {
  if (currentMode !== 'managed-client-mcp-ws') {
    return true;
  }

  return Boolean(managedClientSessionToken) || Boolean(managedClientRuntime?.getStatus().running);
}

// Session notification setting
let sessionNotificationEnabled = true;

function buildBootstrapState() {
  const runtimeStatus = managedClientRuntime?.getStatus();
  const mcpWsStatus = managedClientRuntime instanceof ManagedClientMcpWsRuntime
    ? managedClientRuntime.getStatus()
    : null;
  const workspacePaths = getManagedClientWorkspacePaths(managedClientConfig.workspaceRoot);
  const sessionIdentity = getManagedClientSessionIdentity(managedClientSessionToken);

  return {
    mode: currentMode,
    headless: managedClientConfig.headless,
    baseUrl: managedClientConfig.baseUrl,
    signinPageUrl: managedClientConfig.signinPageUrl,
    tlsServername: managedClientConfig.tlsServername,
    workspaceRoot: workspacePaths.rootDir,
    workspaceDirectory: workspacePaths.workDir,
    needsModeSelection,
    needsBaseUrl: currentMode !== 'cli-server' && !managedClientConfig.headless && !needsModeSelection && !(runtimeStatus?.running ?? false),
    running: runtimeStatus?.running ?? false,
    sessionAuthenticated: Boolean(managedClientSessionToken) || Boolean(runtimeStatus?.running),
    clientId: runtimeStatus?.clientId ?? managedClientConfig.clientId,
    connectionId: mcpWsStatus?.connectionId ?? null,
    sessionIdentityLabel: sessionIdentity.label,
    sessionIdentityDetail: sessionIdentity.detail,
    pullStatus: mcpWsStatus?.pullStatus ?? 'idle',
    pulledTaskCount: mcpWsStatus?.pulledTaskCount ?? 0,
    emptyPollCount: mcpWsStatus?.emptyPollCount ?? 0,
    lastPollStatus: mcpWsStatus?.lastPollStatus ?? null,
    lastTaskCommand: mcpWsStatus?.lastTaskCommand ?? null,
    lastPolledAt: mcpWsStatus?.lastPolledAt ?? null,
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
  }) => validateManagedClientTlsConfig({
    baseUrl: payload.baseUrl,
    tlsServername: payload.tlsServername ?? null,
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
    const workspacePaths = getManagedClientWorkspacePaths(getManagedClientWorkspaceRoot());
    const results = await ManagedClientMcpToolRegistry.testExternalServers({
      externalServerConfigs: externalServers,
      version: app.getVersion(),
      workspaceRoot: workspacePaths.rootDir,
      defaultWorkingDirectory: workspacePaths.workDir,
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
    await stopManagedClientRuntime();
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
    token?: string | null;
  }) => {
    const normalizedToken = payload.token?.trim();
    const normalizedSigninPageUrl = payload.signinPageUrl?.trim();
    const normalizedTlsServername = payload.tlsServername?.trim();

    await stopManagedClientRuntime();

    saveManagedClientFileConfig({
      bootstrapBaseUrl: payload.baseUrl,
      signinPageUrl: normalizedSigninPageUrl ? normalizedSigninPageUrl : undefined,
      tlsServername: normalizedTlsServername ? normalizedTlsServername : undefined,
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
    managedClientSessionToken = null;
    saveManagedClientFileConfig({ token: undefined });
    await stopManagedClientRuntime();
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
    registerIpcHandlers(mainWindow, sessionManager, () => sessionNotificationEnabled, canClearAuditHistory);
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
      registerIpcHandlers(mainWindow, sessionManager, () => sessionNotificationEnabled, canClearAuditHistory);
    }
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  managedClientRuntime?.stop();
  managedClientRuntime = null;
});
