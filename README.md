# 🏮 LandGod — AI 驱动的远程设备管理

> Agent → HTTP → Gateway → WebSocket → Worker（土地公）

LandGod 让 AI Agent 通过自然语言远程管理分布在不同网络中的设备。Agent 发 HTTP 请求给 Gateway，Gateway 通过 WebSocket 转发给各台机器上的 Worker（土地公），Worker 在本地执行命令并返回结果。

## 架构

```
┌─────────┐    HTTP     ┌─────────────┐    WebSocket    ┌──────────────┐
│  Agent   │ ─────────→ │   Gateway   │ ──────────────→ │  Worker (1号) │
│ (悟空等) │  :8081     │ (landgod-   │  :8080         │  ZhouTest1   │
└─────────┘             │  gateway)   │                 └──────────────┘
                        │             │ ──────────────→ ┌──────────────┐
                        └─────────────┘                 │  Worker (4号) │
                                                        │  ZhouTest4   │
                                                        └──────────────┘
```

## 核心组件

| 组件 | 包名 | 说明 |
|------|------|------|
| **Worker** | `landgod` | 部署在被管理设备上，执行命令、读文件、管理 MCP Server |
| **Gateway (Node.js)** | `landgod-gateway` | Agent 边车网关，HTTP↔WebSocket 协议转换 |
| **Gateway (Python)** | `landgod_gateway` | Python 版 Gateway 客户端 SDK |

## 快速开始

### 1. 安装 Gateway（在 Agent 所在机器）

```bash
npm install -g landgod-gateway
landgod-gateway start --daemon
landgod-gateway --version
```

### 2. 安装 Worker（在被管理的设备上）

```bash
npm install -g landgod
landgod onboard          # 交互式配置向导
landgod start            # 启动
landgod --version
```

### 3. Agent 调用

```bash
# 查看连接的设备
curl http://localhost:8081/clients

# 在远程设备上执行命令
curl -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"shell_execute","arguments":{"command":"hostname"}}'
```

## Worker 运行模式

| 模式 | 需要 Electron | 适合场景 |
|------|:------------:|---------|
| **Headless** | ❌ | 服务器、CI/CD、无 GUI 环境 |
| **GUI** | ✅ | 需要桌面 UI 的场景 |

```bash
# Headless 模式（推荐，无需 Electron）
landgod config set mode managed-client-mcp-ws
landgod start

# GUI 模式（需要先安装 Electron）
cd $(node -e "console.log(require.resolve('landgod/package.json').replace('/package.json',''))")
npm install
landgod start --gui
```

## 权限级别

| Profile | 命令数 | 适合场景 |
|---------|:-----:|---------|
| `command-only` | 19 | 只读监控（echo, ls, cat, ps...） |
| `interactive-trusted` | 32 | 开发运维（+ npm, git, python, curl...） |
| `full-local-admin` | 47 | 完全管理（+ rm, systemctl, apt...） |

```bash
landgod config set builtInTools.permissionProfile full-local-admin
```

## 内置工具

| 工具 | 说明 |
|------|------|
| `shell_execute` | 执行 shell 命令（受白名单约束） |
| `file_read` | 读取文件内容 |
| `session_create` | 创建交互式终端会话 |
| `session_stdin` | 向会话发送输入 |
| `session_read` | 读取会话输出 |
| `session_wait` | 等待会话结束 |
| `remote_configure_mcp_server` | 远程配置 MCP Server |

## 安全机制

- **Ed25519 签名验证** — Gateway 签发的每条指令都有签名，Worker 验证后才执行
- **命令白名单** — 只允许执行配置中列出的命令
- **工作目录限制** — 只能在指定目录下操作
- **审计日志** — 所有操作记录到 `audit.jsonl`
- **Token 认证** — Worker 连接 Gateway 需要有效 Token
- **单实例保护** — 启动时自动杀掉旧进程，防止多实例冲突

```bash
landgod audit          # 查看审计日志
landgod audit clear    # 清空审计日志
```

## 项目结构

```
landgod/
├── bin/landgod.js              # Worker CLI 入口
├── src/main/                   # Worker 核心源码 (TypeScript)
│   ├── managed-client/         # WebSocket 客户端 + 配置
│   ├── builtin-tools/          # 内置工具实现
│   └── headless-bootstrap.js   # Headless 模式 Electron mock
├── gateway/
│   ├── sdk-node/               # Gateway Node.js 版
│   │   ├── bin/landgod-gateway.js
│   │   └── server/index.js
│   └── sdk-python/             # Gateway Python 版
├── docs/                       # 知识库文档
├── downloads/                  # 构建产物 + 快速入门
├── scripts/                    # 部署脚本
├── examples/                   # 配置模板 + Docker
└── CHANGELOG.md                # 版本更新记录
```

## 构建

```bash
make clean && make
```

产物在 `downloads/` 目录：
- `landgod-0.1.0.tgz` — Worker npm 包
- `landgod-gateway-0.1.0.tgz` — Gateway Node.js npm 包
- `landgod_gateway-0.1.0-py3-none-any.whl` — Gateway Python 包

## 文档

| 文档 | 内容 |
|------|------|
| [网络前置条件](docs/00-network-prerequisites.md) | 不同网络环境的连接方案 |
| [Gateway API](docs/01-landgod-link-api.md) | HTTP API 参考 |
| [MCP-WS 协议](docs/02-mcp-ws-protocol.md) | WebSocket 通信协议 |
| [部署 Gateway](docs/03-deploy-gateway.md) | Gateway 安装配置 |
| [安装 Worker](docs/04-connect-install-worker.md) | Worker 部署指南 |
| [Onboard 向导](docs/05-onboard-landgod.md) | 交互式配置说明 |
| [架构对比](docs/07-architecture-comparison.md) | 架构选型参考 |
| [GUI vs Headless](docs/08-gui-vs-headless.md) | 运行模式对比 |

## License

Private — All rights reserved.
