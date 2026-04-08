# Changelog

All notable changes to **X Claw Node** will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-04-08

> 基线版本。包含完整的 managed-client-mcp-ws 模式、本地工具集、外部 MCP 服务器集成、安全防护体系和桌面管理 UI。

### Core Architecture

- Electron 桌面客户端，支持三种运行模式：`cli-server`、`managed-client`（HTTP polling）、`managed-client-mcp-ws`（WebSocket 出站）
- WebSocket 运行时（`ManagedClientMcpWsRuntime`）：出站连接远端 MCP Hub，双向实时通信
- MCP SDK 集成，通过 InMemoryTransport 注册本地工具集
- Express HTTP 服务器（端口 19876），提供本地 SSE 和 WebSocket CLI 协议
- React SPA 管理界面（Vite + Tailwind CSS）

### Built-in Tools

- `shell_execute` — Shell 命令执行（PowerShell/sh），支持白名单过滤、管道/重定向控制、网络命令限制
- `file_read` — 本地文件内容读取
- `session_create` — 创建持久化交互式 Shell 会话
- `session_stdin` — 向会话发送 stdin 输入
- `session_wait` — 等待会话状态变化（退出/超时）
- `session_read_output` — 分页读取会话 stdout/stderr 输出
- `remote_configure_mcp_server` — 远程配置外部 MCP 服务器（创建/更新）

### Permission System

- 三级权限档位：`command-only` < `interactive-trusted` < `full-local-admin`
- 按权限档位过滤可发布工具、控制 shell 能力（管道/重定向、网络命令）
- 工作目录隔离（command-only / interactive-trusted 受限于 workspace）
- 可执行文件白名单（`allowedExecutables`）和工作目录白名单（`allowedWorkingDirectories`）

### External MCP Server Integration

- 支持 HTTP (StreamableHTTP) 和 stdio 两种传输协议
- 四级信任模型：`trusted` / `internal-reviewed` / `experimental` / `blocked`
- 远程创建的服务器默认 `experimental` 信任级别，需手动提升后才能远程发布
- 工具发布白名单机制（必须显式指定 `tools` 列表）
- 并行连接外部服务器（`Promise.allSettled`），单个失败不影响其他
- 连接/listTools 超时保护（5 分钟）
- `republishTools()` 快速重发布（不重连外部服务器，仅重建绑定）

### Security

- TLS 强制验证（非 loopback 必须 wss://，`rejectUnauthorized: true`）
- Bearer Token 认证（WebSocket Authorization 头）
- 工具调用签名验证（Ed25519 / HMAC-SHA256，公钥来自握手阶段）
- 防重放保护（nonce 缓存 + ±30 秒时钟偏移容忍）
- 敏感信息脱敏（私钥、AWS 密钥、GitHub Token、连接字符串、JWT 等）
- 响应大小分级限制（status-only 1KB / handle 4KB / full 16KB）
- 断线指数退避重连

### Authentication

- 浏览器 OAuth 登录流程（打开系统浏览器 → 本地回调接收 JWT）
- JWT payload 解析用户身份（preferred_username / email / name）
- 5 分钟登录超时

### Logging & Observability

- 审计日志（JSONL）：全量命令记录、stdout/stderr（截断至 10KB）、exit code、耗时、客户端 IP
- 操作历史（JSONL）：9 类操作事件，支持分页查询和搜索
- 实时事件广播（IPC → Renderer）

### UI Pages

- **Dashboard** — 实时会话列表、服务器连接状态、工具数量、WebSocket 指标
- **Permissions** — 权限档位选择与预览
- **Built-in Tools** — Shell/FileRead 白名单配置、MCP Server Admin 开关
- **External MCP Servers** — 添加/测试/编辑外部 MCP 服务器、信任级别管理
- **Audit Log** — 审计日志搜索与导出
- **Activities** — 操作历史浏览（分页，每页 20 条）
- **Settings** — 工作区路径、通知开关

### i18n

- 支持英文（`en`）和简体中文（`zh-CN`）
- 自动检测系统 locale
- 模板变量替换

### Build & Packaging

- Electron Forge + Vite（main / preload / renderer 三独立构建）
- Windows Squirrel (.exe)、macOS DMG、Linux Deb/RPM
- Context-isolated preload bridge（`contextBridge.exposeInMainWorld`）

---

<!-- 
后续版本模板：

## [0.2.0] — YYYY-MM-DD

### Added
- 新功能描述

### Changed
- 修改描述

### Fixed
- 修复描述

### Removed
- 移除描述

### Security
- 安全修复描述
-->
