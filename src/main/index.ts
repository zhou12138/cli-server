import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'node:path';
import { startServer } from './server';
import { registerIpcHandlers, getPort } from './ipc/handlers';
import { auditLogger } from './audit/logger';
import { createT, type Locale } from '../i18n';
import { SessionManager } from './session/manager';

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

  // Enable DevTools in all builds
  mainWindow.webContents.openDevTools({ mode: 'detach' });

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

function createTray(): void {
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
      label: t('tray.serverRunning', { port: getPort() }),
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

app.whenReady().then(async () => {
  // Initialize audit logger
  auditLogger.init();

  // Create the browser window
  createWindow();

  // Register IPC handlers
  if (mainWindow) {
    registerIpcHandlers(mainWindow, sessionManager);
  }

  // Start the embedded server
  try {
    await startServer(getPort(), sessionManager);
    console.log(`Server started on port ${getPort()}`);
  } catch (err) {
    console.error('Failed to start server:', err);
  }

  // Create system tray
  createTray();
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
      registerIpcHandlers(mainWindow, sessionManager);
    }
  } else {
    mainWindow.show();
  }
});
