# Changelog

All notable changes to LandGod will be documented in this file.

## [0.1.0] — 2026-04-16

### Added
- **LandGod Worker** (`landgod`) — 远程执行节点
  - GUI 模式（Electron）和 Headless 模式（纯 Node.js）
  - 7 个内置工具：shell_execute, file_read, session_create/stdin/read/wait, remote_configure_mcp_server
  - 3 个权限级别：command-only (19 命令), interactive-trusted (32 命令), full-local-admin (47 命令)
  - 默认白名单：设 `permissionProfile` 即可，无需手动配置命令列表
  - 运行时自动检测工作目录（home, tmp, install dir）
  - `landgod onboard` 交互式配置向导（10 步）
  - `landgod start/stop/status/audit/audit clear/config/--version`
  - Ed25519 签名验证、命令白名单、目录限制、审计日志
  - 安全警告：配置 bash/sh 白名单时发出警告

- **LandGod Gateway** (`landgod-gateway`) — Agent 边车网关
  - HTTP API (:8081) 供 Agent 调用
  - WebSocket (:8080) 供 Worker 连接
  - Token 管理（创建/列出/吊销）
  - 连接管理：自动清理死连接、注册时去重
  - 单实例保护：启动时杀掉旧进程
  - `landgod-gateway start/stop/status/--version`

- **Python SDK** (`landgod_gateway`) — Gateway Python 客户端
  - 内存/Redis 状态存储
  - `pip install landgod-gateway[redis]`

- **部署工具**
  - `landgod-deploy.sh` — Linux 一键远程部署
  - `landgod-deploy.ps1` — Windows 一键远程部署
  - Docker 示例 (Dockerfile.gateway, Dockerfile.worker, docker-compose.yml)
  - 配置模板 (command-only, full-admin)

- **文档**
  - 8 篇知识库文档 (docs/00-08)
  - 快速入门 (QUICKSTART-GATEWAY.md, QUICKSTART-WORKER.md)
  - 网络环境前置条件
  - 架构对比与场景推荐

### Security
- 移除 bash/sh 白名单默认值
- 配置危险路径时发出安全警告
- MCP Server 默认 publishedRemotely=true, trustLevel=trusted

### Removed
- managed-client HTTP 轮询模式（只保留 mcp-ws）
- X Claw Node 旧命名

## [0.1.0-rc2] — 2026-04-21

### Added
- **Python Gateway Server** (`landgod-gateway-server`) — 完整 Python 版 Gateway
  - 支持单机（内存）和分布式（Redis）部署
  - WebSocket + HTTP API，协议与 Node.js 版完全兼容
  - `landgod-gateway-py start [--token TOKEN] [--redis URL]`
- **GET /tools** endpoint — 查看每个 Worker 注册的工具列表
- **`landgod mcp show`** — 查看 MCP Server 配置
- **`landgod daemon start --headless`** — 纯 Node.js headless 模式，不需要 Electron
- **`--token` 参数** — Gateway 启动时指定 token，不再使用默认 hardcoded token
- **landgod-deploy skill** — 部署指南 skill，其他 Agent 可直接使用
- **landgod-operate skill** — 操作设备 skill，含 MCP 配置和故障排查

### Changed
- Gateway 改为 single-token 模式，移除 tokens.json
- Token 必须通过 `--token` 或 `LANDGOD_AUTH_TOKEN` 显式指定
- 目录重构：`sdk-node` → `node-gateway`，`sdk-python` → `python-sdk`
- Makefile 增加 headless-entry.js 构建步骤

### Fixed
- Gateway clientName 路由：找不到时返回 404，不再静默路由到其他 Worker
- Worker permissionProfile 序列化/反序列化丢失
- headless-entry.ts ROOT_DIR 路径修复（Windows 兼容）
- headless-entry.ts runtime.start() 不返回 Promise 的崩溃
- toolCallApprovalMode 默认 manual 在 headless 下自动拒绝的问题
- Node.js Gateway daemon --token 参数传递给子进程
- websockets 16 API 兼容性（Python Gateway）
