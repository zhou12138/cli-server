import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain } from 'electron';
import * as path from 'node:path';
import { startServer } from './server';
import { registerIpcHandlers, getPort } from './ipc/handlers';
import { auditLogger } from './audit/logger';
import { createT, type Locale } from '../i18n';
import { SessionManager } from './session/manager';
import { ManagedClientRuntime } from './managed-client/runtime';
import { getManagedClientRuntimeConfig, saveManagedClientFileConfig } from './managed-client/config';

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
let managedClientRuntime: ManagedClientRuntime | null = null;
let managedClientConfig = getManagedClientRuntimeConfig(app.getVersion());
let isManagedClientMode = managedClientConfig.enabled;

// Session notification setting
let sessionNotificationEnabled = true;

app.whenReady().then(async () => {
  managedClientConfig = getManagedClientRuntimeConfig(app.getVersion());
  isManagedClientMode = managedClientConfig.enabled;

  // Initialize audit logger
  auditLogger.init();

  // IPC for notification setting
  ipcMain.handle('settings:getNotification', () => sessionNotificationEnabled);
  ipcMain.handle('settings:setNotification', (_e, enabled: boolean) => {
    sessionNotificationEnabled = enabled;
    return sessionNotificationEnabled;
  });
  ipcMain.handle('managed-client:getBootstrapState', () => ({
    mode: isManagedClientMode ? 'managed-client' : 'cli-server',
    headless: managedClientConfig.headless,
    baseUrl: managedClientConfig.baseUrl,
    needsBaseUrl: isManagedClientMode && !managedClientConfig.headless && !(managedClientRuntime?.getStatus().running ?? false),
    running: managedClientRuntime?.getStatus().running ?? false,
  }));
  ipcMain.handle('managed-client:saveBaseUrlAndStart', async (_e, baseUrl: string) => {
    saveManagedClientFileConfig({ bootstrapBaseUrl: baseUrl });
    managedClientConfig = getManagedClientRuntimeConfig(app.getVersion());
    isManagedClientMode = managedClientConfig.enabled;

    if (!managedClientRuntime && managedClientConfig.enabled) {
      managedClientRuntime = new ManagedClientRuntime(managedClientConfig, sessionManager);
      managedClientRuntime.start();
    }

    return {
      mode: isManagedClientMode ? 'managed-client' : 'cli-server',
      headless: managedClientConfig.headless,
      baseUrl: managedClientConfig.baseUrl,
      needsBaseUrl: false,
      running: managedClientRuntime?.getStatus().running ?? false,
    };
  });

  if (!managedClientConfig.headless) {
    // Create the browser window
    createWindow();
  }

  // Register IPC handlers
  if (mainWindow) {
    registerIpcHandlers(mainWindow, sessionManager, () => sessionNotificationEnabled);
  }

  if (!managedClientConfig.headless && !isManagedClientMode) {
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
    createTray(isManagedClientMode);
  }

  if (managedClientConfig.enabled) {
    try {
      if (managedClientConfig.headless && managedClientConfig.baseUrl) {
        managedClientRuntime = new ManagedClientRuntime(managedClientConfig, sessionManager);
        managedClientRuntime.start();
        console.log('Managed client runtime enabled');
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
