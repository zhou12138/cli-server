# 📋 LandGod TODO

## 部署方式

### ✅ 已完成
- [x] **A. Push 模式** — `landgod-deploy.sh` SSH 推送安装
- [x] **C. 手动模式** — `SETUP.md` 文档指引
- [x] **Headless 模式** — `landgod daemon start --headless` 纯 Node.js，无需 Electron
- [x] **Windows 部署** — `landgod-deploy.ps1` Windows 远程部署脚本

### 🔲 待开发
- [ ] **P0** Push 脚本支持 `--gateway-url` 参数（当前写死 `ws://localhost:8080`）
- [ ] **P1** Pull 模式自助安装脚本 `landgod-bootstrap.sh`
  - 新机器执行一条命令自动安装连接
  - `curl ... | bash -s -- --gateway "ws://x.x.x.x:8080" --token "tok_xxx" --name "my-device"`
- [ ] **P2** Docker 镜像预装
- [ ] **P2** Windows Pull 模式 `landgod-bootstrap.ps1`

## 安全加固

- [ ] **P0** 移除 `bash`/`sh` 白名单（可绕过所有限制）
- [ ] **P0** 配置文件路径保护（shell_execute 禁止访问 config 目录）
- [ ] **P1** 每设备独立 Token（deploy 脚本自动生成）
- [ ] **P1** 签名密钥持久化（Gateway 重启不丢失会话）
- [ ] **P2** 分级审批（高危操作需人工确认）
- [ ] **P2** SSH 密钥按设备隔离

## 功能开发

### ✅ 已完成
- [x] Gateway Token 管理 API（POST/GET/DELETE /tokens）
- [x] MCP Server 默认 publishedRemotely=true, trustLevel=trusted
- [x] landgod-gateway systemd 服务（Gateway 开机自启 + 崩溃自动重启）
- [x] headless-bootstrap.js（Electron mock，纯 Node.js 运行）
- [x] Makefile 含 vite 编译（make = 编译 + 打包）
- [x] Python SDK 分布式状态存储（memory / Redis）

### 🔲 待开发
- [ ] **P1** `POST /batch_tool_call` 并行批量接口（MapReduce 支持）
- [ ] **P1** Gateway 连接 Cloudflare Tunnel 一键支持
- [ ] **P2** Worker 掉线自动通知 Agent
- [ ] **P2** Worker systemd 服务模板
- [ ] **P2** Gateway 签名密钥持久化到文件（重启不丢会话）
- [ ] **P3** Worker 配置自动备份（重装不丢配置）

## 多 Agent

### ✅ 已完成
- [x] 夜游神 (patrol) Agent 注册
- [x] 夜游神 workspace 准备（SOUL/IDENTITY/TOOLS/HEARTBEAT）
- [x] 夜游神 Discord Bot 绑定
- [x] 夜游神 cron 定时巡查（OpenClaw cron，每 5 分钟）
- [x] LandGod Skill 蒸馏（skills/landgod/）

### 🔲 待开发
- [ ] **P1** 太白金星 Agent（通道管理员，SSH 凭据 + 隧道重建）
- [ ] **P2** Agent 间消息传递（夜游神 → 悟空 告警）
- [ ] **P3** Agent 任务委派框架

## 代码质量

- [ ] **P1** `bin/landgod.js` 拆分模块（887 行单文件）
- [ ] **P1** `mcp-ws-runtime.ts` 拆分（1724 行）
- [ ] **P2** 添加单元测试（tool-defense、签名验证）
- [ ] **P2** CI/CD — GitHub Actions: lint + test + build
- [ ] **P3** 统一 logger（替代 console.log）

## 文档

### ✅ 已完成
- [x] `docs/SETUP.md` — 完整搭建指南
- [x] `docs/DOWNLOADS.md` — 产物说明 + API 文档
- [x] `docs/01-landgod-gateway-api.md` — API 参考 + 端口说明
- [x] `docs/02-mcp-ws-protocol.md` — WebSocket 协议规范
- [x] `docs/03-deploy-gateway.md` — Gateway 部署指南
- [x] `docs/04-connect-install-worker.md` — 连接安装 Worker
- [x] `docs/05-onboard-landgod.md` — 模板化配置
- [x] `docs/06-network-setup.md` — 网络环境指南
- [x] `docs/07-architecture-comparison.md` — 架构对比 + 场景推荐

### 🔲 待开发
- [ ] **P2** `CONTRIBUTING.md` — 贡献指南
- [ ] **P3** API 自动生成文档（OpenAPI/Swagger）

## 命名迁移

### ✅ 已完成
- [x] `clawnode` → `landgod`
- [x] `gateway` → `landgod-gateway`
- [x] `XClawNode` → `LandGod`
- [x] 旧文件清理（clawnode.js, XClawNode.sh 等）

### 🔲 待开发
- [ ] **P3** 仓库名 `landgod` → `landgod`（需要你操作 GitHub）
- [ ] **P3** `gateway/` 目录 → `packages/`（monorepo 标准化）

## 已知问题

- ⚠️ 跨境 SSH 隧道不稳定（Azure↔阿里云），需要 Cloudflare Tunnel
- ⚠️ Windows Server Electron headless 模式不稳定，需用 headless-bootstrap.js
- ⚠️ Gateway 之前无 systemd 守护导致进程被杀（已修复）
- ⚠️ npm install -g 后配置文件被覆盖（重装需重新配置）
