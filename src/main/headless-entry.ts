/**
 * headless-entry.ts — 纯 Node.js 入口（无 Electron 依赖）
 * 
 * 用法: node headless-entry.js [options]
 *   --enable-managed-client-mcp-ws    启用 WebSocket managed client
 *   --managed-client-mcp-ws-only      仅运行 managed client（无 HTTP server）
 * 
 * 环境变量:
 *   LANDGOD_DATA_DIR   数据目录（默认: .landgod-data）
 *   DISPLAY               虚拟显示（Linux headless 用）
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { SessionManager } from './session/manager';
import { ManagedClientMcpWsRuntime } from './managed-client/mcp-ws-runtime';
import { getManagedClientRuntimeConfig } from './managed-client/config';
import { auditLogger } from './audit/logger';
import { activityLogger } from './activity/logger';
import { emitServerEvent, onServerEvent } from './server';

// ========================
// 数据目录（替代 Electron 的 app.getPath）
// ========================
// __dirname is .vite/build/ in built mode, need to go up 2 levels to package root
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DATA_DIR = process.env.LANDGOD_DATA_DIR || path.join(ROOT_DIR, '.landgod-data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Ensure process.cwd() is the package root so config files are found correctly
// (managed-client.config.json and managed-client.mcp-servers.json use process.cwd())
process.chdir(ROOT_DIR);

// 设置全局数据目录供 logger 使用
process.env.LANDGOD_DATA_DIR = DATA_DIR;

// ========================
// 初始化
// ========================
console.log('[headless] LandGod Headless Runtime starting...');
console.log(`[headless] Data dir: ${DATA_DIR}`);
console.log(`[headless] Root dir: ${ROOT_DIR}`);

// 初始化日志
auditLogger.init();
activityLogger.init();

// 事件监听
onServerEvent((event) => {
  // 在 headless 模式下仅打印关键事件
  if (event.type.includes('error') || event.type.includes('rejected')) {
    console.error(`[event] ${event.type}`, event.data ? JSON.stringify(event.data).substring(0, 200) : '');
  }
});

// ========================
// 启动 managed-client-mcp-ws
// ========================
const config = getManagedClientRuntimeConfig('0.1.0');
console.log(`[headless] Config:`, {
  enabled: config.enabled,
  mode: config.mode,
  baseUrl: config.baseUrl,
  hasToken: !!config.token,
});

if (!config.enabled || !config.baseUrl) {
  console.error('[headless] Managed client is not enabled or baseUrl is not set. Run `landgod config` first.');
  process.exit(1);
}

const sessionManager = new SessionManager();

const runtime = new ManagedClientMcpWsRuntime(config, sessionManager);

runtime.start();
console.log("[headless] Managed client runtime started.");

// ========================
// 保持进程运行 + 优雅退出
// ========================
process.on('SIGINT', () => {
  console.log('[headless] Received SIGINT, shutting down...');
  runtime.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[headless] Received SIGTERM, shutting down...');
  runtime.stop();
  process.exit(0);
});

// 防止进程退出
setInterval(() => {}, 60000);
