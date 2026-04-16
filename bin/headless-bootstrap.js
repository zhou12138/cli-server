#!/usr/bin/env node
/**
 * headless-bootstrap.js — LandGod 纯 Node.js Headless 启动器
 * 
 * 原理: mock Electron 模块，使 .vite/build/index.js 能在 Node.js 中运行
 * 
 * 用法: node headless-bootstrap.js
 * 环境变量: LANDGOD_DATA_DIR — 数据目录
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.LANDGOD_DATA_DIR || path.join(ROOT_DIR, '.landgod-data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 注入命令行参数（模拟 Electron 启动参数）
if (!process.argv.includes('--enable-managed-client-mcp-ws')) {
    process.argv.push('--enable-managed-client-mcp-ws');
}
if (!process.argv.includes('--managed-client-mcp-ws-only')) {
    process.argv.push('--managed-client-mcp-ws-only');
}

// Mock Electron 模块
const electronMock = {
    app: {
        getPath: (name) => {
            if (name === 'userData') return DATA_DIR;
            if (name === 'home') return require('os').homedir();
            if (name === 'temp') return require('os').tmpdir();
            return DATA_DIR;
        },
        getVersion: () => '0.1.0',
        getLocale: () => 'en',
        setPath: () => {},
        commandLine: { appendSwitch: () => {} },
        whenReady: () => Promise.resolve(),
        quit: () => process.exit(0),
        on: () => {},
        isReady: () => true,
        getName: () => 'LandGod',
    },
    BrowserWindow: class BrowserWindow {
        constructor() { this.webContents = { on: () => {}, send: () => {} }; }
        loadURL() {}
        on() {}
    },
    Tray: class Tray {
        constructor() {}
        setToolTip() {}
        setContextMenu() {}
        on() {}
    },
    Menu: {
        buildFromTemplate: () => ({}),
    },
    nativeImage: {
        createFromPath: () => ({}),
        createEmpty: () => ({}),
    },
    Notification: class Notification {
        constructor() {}
        show() {}
    },
    ipcMain: {
        handle: () => {},
        on: () => {},
        removeHandler: () => {},
    },
    shell: {
        openExternal: async (url) => {
            console.log(`[headless] shell.openExternal skipped: ${url}`);
        },
    },
};

// 劫持 require('electron')
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'electron') {
        return 'electron'; // 返回一个虚拟路径
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return electronMock;
    }
    return originalLoad.call(this, request, parent, isMain);
};

console.log('[headless] LandGod Headless Mode (No Electron)');
console.log(`[headless] Data dir: ${DATA_DIR}`);
console.log(`[headless] Root dir: ${ROOT_DIR}`);

// 加载主入口
const mainEntry = path.join(ROOT_DIR, '.vite', 'build', 'index.js');
if (!fs.existsSync(mainEntry)) {
    console.error(`[headless] ERROR: Main entry not found: ${mainEntry}`);
    process.exit(1);
}

require(mainEntry);

// 保持进程运行
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
