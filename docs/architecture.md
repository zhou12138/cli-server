# X Claw Node — 架构与功能说明

> 版本: 0.1.0 | 更新日期: 2026-04-08

---

## 一、项目定位

X Claw Node 是一个 **Electron 桌面客户端**，充当 Web 端 AI Agent 的本地执行网关。它通过 WebSocket 出站连接到远端 MCP Hub，将桌面侧的 shell 执行、文件读取、外部 MCP 服务器等能力安全地暴露给远端 AI。

**核心价值**：让 AI Agent 能在用户授权下，安全、可审计地操作用户本机环境。

---

## 二、运行模式

| 模式 | 说明 | 状态 |
|------|------|------|
| `cli-server` | 本地 HTTP API 服务器，直接通过 REST/SSE 对外暴露 MCP 工具 | 基础可用 |
| `managed-client` | HTTP 长轮询模式，向远端服务器拉取任务并回报结果 | 遗留模式 |
| **`managed-client-mcp-ws`** | **WebSocket 出站模式**，连接远端 MCP Hub，双向实时通信 | ✅ 主力模式 |

---

## 三、系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     X Claw Node (Electron)                  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Renderer Process (React SPA)                        │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐  │   │
│  │  │Dashboard │ │Permissions│ │BuiltInTools          │  │   │
│  │  ├──────────┤ ├──────────┤ ├──────────────────────┤  │   │
│  │  │AuditLog  │ │Activities│ │ExternalMcpServers    │  │   │
│  │  ├──────────┤ ├──────────┤ ├──────────────────────┤  │   │
│  │  │Settings  │ │          │ │                      │  │   │
│  │  └──────────┘ └──────────┘ └──────────────────────┘  │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                   IPC (context-isolated)                     │
│  ┌───────────────────────┴──────────────────────────────┐   │
│  │  Main Process                                        │   │
│  │                                                      │   │
│  │  ┌──────────────────┐  ┌──────────────────────────┐  │   │
│  │  │ MCP Server       │  │ ManagedClientMcpWsRuntime│  │   │
│  │  │ (InMemory)       │  │ (WebSocket Client)       │  │   │
│  │  │ ● shell_execute  │  │ ● 连接/握手/注册         │  │   │
│  │  │ ● file_read      │◄─┤ ● 工具发布              │  │   │
│  │  │ ● session_*      │  │ ● 工具调用路由           │  │   │
│  │  │ ● remote_config  │  │ ● 签名验证              │  │   │
│  │  └────────┬─────────┘  └────────┬─────────────────┘  │   │
│  │           │                     │                     │   │
│  │  ┌────────▼─────────────────────▼─────────────────┐  │   │
│  │  │ ManagedClientMcpToolRegistry                   │  │   │
│  │  │ ● 本地工具绑定 + 外部 MCP 服务器工具绑定       │  │   │
│  │  │ ● 工具调用路由 (local / external)              │  │   │
│  │  │ ● 工具定义汇总与发布                           │  │   │
│  │  └──────────────────────┬─────────────────────────┘  │   │
│  │                         │                             │   │
│  │  ┌──────────┐  ┌───────▼──────┐  ┌────────────────┐  │   │
│  │  │SessionMgr│  │External MCP  │  │ Tool Defense   │  │   │
│  │  │(进程管理) │  │Servers       │  │ Layer          │  │   │
│  │  │          │  │(HTTP/stdio)  │  │(敏感信息脱敏)  │  │   │
│  │  └──────────┘  └──────────────┘  └────────────────┘  │   │
│  │                                                      │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │AuditLog  │  │ActivityLog   │  │Config Manager  │  │   │
│  │  │(.jsonl)  │  │(.jsonl)      │  │(.json files)   │  │   │
│  │  └──────────┘  └──────────────┘  └────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ wss:// (TLS + Bearer Token)
                            ▼
                   ┌─────────────────┐
                   │  Remote MCP Hub │
                   │  (Societas)     │
                   └─────────────────┘
```

---

## 四、模块说明

### 4.1 Main Process 入口 (`src/main/index.ts`)

| 职责 | 说明 |
|------|------|
| Electron 生命周期 | 窗口创建、系统托盘、应用退出 |
| 模式选择 | CLI Server / Managed Client / MCP-WS 三种模式的初始化 |
| IPC 桥接 | 所有 Renderer ↔ Main 的 IPC handle 注册 |
| Activity 记录 | 操作历史追踪（配置保存、连接状态变更、工具发布等 9 类操作） |
| 引导状态管理 | `buildBootstrapState()` 供 UI 同步连接状态、工具数量、模式信息 |

### 4.2 WebSocket 运行时 (`src/main/managed-client/mcp-ws-runtime.ts`)

核心模块，负责与远端 MCP Hub 的全生命周期管理。

**协议流程：**

```
CONNECT (wss:// + Bearer Token)
    ↓
session_opened (收到 connectionId)
    ↓
register (发送 client_id, client_name)
    ↓
update_tools (发布所有本地 + 外部工具定义)
    ↓
readLoop ──┬── tool_call → 验签 → 执行 → result_chunk/tool_error
           ├── ping → pong
           └── ... 持续接收事件
```

**关键能力：**
- TLS 强制验证（非 loopback 必须 wss://）
- 工具调用签名验证（Ed25519 / HMAC-SHA256）
- 防重放保护（nonce 缓存 + ±30s 时钟偏移容忍）
- 断线重连（指数退避）
- 动态工具重发布（`republishTools()` / `updateMcpServers()`）

### 4.3 MCP 服务器 (`src/main/mcp/server.ts`)

通过 MCP SDK 注册的本地工具集：

| 工具 | 功能 | 权限要求 |
|------|------|----------|
| `shell_execute` | 执行 Shell 命令（PowerShell/sh） | command-only+ |
| `file_read` | 读取本地文件内容 | full-local-admin |
| `remote_configure_mcp_server` | 远程配置外部 MCP 服务器 | full-local-admin |
| `session_create` | 创建交互式 Shell 会话 | interactive-trusted+ |
| `session_stdin` | 向会话发送 stdin 输入 | interactive-trusted+ |
| `session_wait` | 等待会话状态变化 | interactive-trusted+ |
| `session_read_output` | 分页读取会话输出 | full-local-admin |

### 4.4 工具注册中心 (`src/main/managed-client/mcp-tool-registry.ts`)

| 职责 | 说明 |
|------|------|
| 工具聚合 | 将本地 MCP 工具 + 外部 MCP 服务器工具统一注册 |
| 权限过滤 | 按当前权限档位决定哪些工具可以发布到远端 |
| 名称映射 | 外部工具统一前缀：`<serverName>.<toolName>` |
| 调用路由 | 根据 `ToolBinding.source` 将调用转发到本地或外部 client |
| 超时保护 | 外部服务器连接/listTools 带超时，失败跳过不阻塞 |
| 并行连接 | 外部 MCP 服务器并行连接（`Promise.allSettled`） |

### 4.5 权限系统 (`src/main/builtin-tools/types.ts`)

**三级权限档位：**

```
command-only  <  interactive-trusted  <  full-local-admin
```

| 能力 | command-only | interactive-trusted | full-local-admin |
|------|:---:|:---:|:---:|
| shell_execute | ✅ | ✅ | ✅ |
| 管道/重定向 | ❌ | ✅ | ✅ |
| 网络命令 | ❌ | ❌ | ✅ |
| session_* (交互会话) | ❌ | ✅ | ✅ |
| file_read | ❌ | ❌ | ✅ |
| remote_configure_mcp_server | ❌ | ❌ | ✅ |
| 外部 MCP 服务器 | ❌ | ❌ | ✅ |
| 工作目录限制 | 受限于 workspace | 受限于 workspace | 不限制 |

### 4.6 工具防御层 (`src/main/managed-client/tool-defense.ts`)

| 机制 | 说明 |
|------|------|
| 敏感信息脱敏 | 正则匹配并掩码：私钥、AWS 密钥、GitHub Token、连接字符串、JWT |
| 响应大小限制 | `status-only` 1KB / `handle` 4KB / `full` 16KB |
| 结果模式控制 | 按权限档位 + 工具来源决定返回详细程度 |

### 4.7 外部 MCP 服务器管理

**配置文件：** `managed-client.mcp-servers.json`

**支持的传输协议：**
- HTTP（StreamableHTTP）— 连接远程 MCP 服务
- stdio — 启动本地子进程（如 `npx @playwright/mcp`）

**信任级别（Trust Level）：**

| 级别 | 可远程发布 | 可被远程工具创建/修改 |
|------|:---:|:---:|
| `trusted` | ✅ | ❌ |
| `internal-reviewed` | ✅ | ❌ |
| `experimental` | ❌（需手动提升） | ✅ |
| `blocked` | ❌ | ❌ |

**远程发布条件：**
1. `publishedRemotely: true`
2. 信任级别为 `trusted` 或 `internal-reviewed`
3. 必须显式指定 `tools` 白名单（不允许通配符）
4. 当前权限档位满足 `requiredPermissionProfile`

### 4.8 会话管理器 (`src/main/session/manager.ts`)

- 每个会话独立 sessionId，跟踪进程状态（running/exited）
- 支持 stdin 管道（交互式），支持 stdout/stderr 分流捕获
- 输出分页读取（offset + limit）
- 进程退出后自动审计：exit code、signal、duration

### 4.9 认证与登录 (`src/main/managed-client/signin.ts`)

- 打开系统浏览器访问 `signinPageUrl`
- 本地临时 HTTP 服务器接收回调（JWT token）
- 5 分钟超时
- 支持 MSAL（Azure AD）集成

### 4.10 审计日志 (`src/main/audit/logger.ts`)

- JSONL 格式持久化，存储在 Electron userData 目录
- 记录内容：命令、工作目录、exit code、signal、stdout/stderr（截断至 10KB）、耗时、客户端 IP
- 支持搜索、导出

### 4.11 操作历史 (`src/main/activity/logger.ts`)

- JSONL 格式，记录用户层面的操作事件
- 9 类操作：配置保存、MCP 服务器配置、模式选择、登录/退出、工具刷新等
- 支持分页查询和搜索

### 4.12 配置管理 (`src/main/managed-client/config.ts`)

| 文件 | 内容 |
|------|------|
| `managed-client.config.json` | 模式、Base URL、TLS、Client ID、权限档位、工具安全策略 |
| `managed-client.mcp-servers.json` | 外部 MCP 服务器定义 |
| `audit.jsonl` | 审计日志（追加写入） |
| `activities.jsonl` | 操作历史（追加写入） |

### 4.13 HTTP 服务器 (`src/main/server/`)

- Express 服务，端口 19876
- 提供本地 MCP SSE 端点（`cli-server` 模式用）
- WebSocket handler 用于本地 CLI 会话协议
- 连接追踪与事件广播

### 4.14 Renderer UI (`src/renderer/`)

| 页面 | 功能 |
|------|------|
| Dashboard | 实时会话列表、服务器状态、连接信息 |
| Permissions | 权限档位选择 |
| Built-in Tools | Shell/FileRead 白名单配置、MCP Server Admin 开关 |
| External MCP Servers | 添加/测试/配置外部 MCP 服务器，编辑信任级别 |
| Audit Log | 审计日志搜索/导出 |
| Activities | 操作历史（分页浏览） |
| Settings | 工作区路径、通知开关 |

### 4.15 国际化 (`src/i18n/`)

- 支持 `en`（英文）和 `zh-CN`（简体中文）
- 自动检测系统 locale
- 模板变量替换（`{total}`, `{current}` 等）

---

## 五、安全架构

```
┌─────────────────────────────────────────────────────┐
│                   Security Layers                   │
│                                                     │
│  Layer 1: Transport Security                        │
│  ├── TLS 强制（非 loopback 必须 wss://）            │
│  ├── rejectUnauthorized: true                       │
│  └── SNI hostname 校验 (tlsServername)              │
│                                                     │
│  Layer 2: Authentication                            │
│  ├── Bearer Token（WebSocket Authorization 头）     │
│  └── 浏览器 OAuth 登录流程                          │
│                                                     │
│  Layer 3: Integrity (Tool Call)                      │
│  ├── 签名验证（公钥来自握手阶段）                   │
│  ├── 防重放（nonce 缓存 + ±30s 时钟偏移）          │
│  └── requestId 绑定                                 │
│                                                     │
│  Layer 4: Authorization                              │
│  ├── 三级权限档位                                   │
│  ├── 工具白名单（可执行文件名、工作目录）           │
│  └── 外部 MCP 服务器信任级别                        │
│                                                     │
│  Layer 5: Data Protection                            │
│  ├── 敏感信息脱敏（私钥、Token、连接字符串）        │
│  ├── 响应大小限制（按模式分级）                     │
│  └── 工作区目录隔离                                 │
│                                                     │
│  Layer 6: Observability                              │
│  ├── 审计日志（全量命令 + I/O 记录）                │
│  ├── 操作历史（用户操作追踪）                       │
│  └── 实时事件广播（UI 实时更新）                    │
└─────────────────────────────────────────────────────┘
```

---

## 六、数据流（远端 AI → 本机执行 → 结果返回）

```
Remote AI (MCP Hub)
    │
    │  tool_call (signed)
    ▼
ManagedClientMcpWsRuntime
    │  1. 验证签名
    │  2. 检查 nonce/防重放
    │  3. 审计记录
    ▼
ManagedClientMcpToolRegistry
    │  路由: local tool 还是 external MCP server?
    │
    ├──► Local Tool (shell_execute / file_read / session_*)
    │       │  权限检查 → 白名单校验 → 执行
    │       │  SessionManager.create() → spawn shell
    │       │  捕获 stdout/stderr → 审计写入
    │       ▼
    │    Raw Result
    │
    ├──► External MCP Server (HTTP / stdio)
    │       │  信任级别检查 → client.callTool()
    │       ▼
    │    Raw Result
    │
    ▼
Tool Defense Layer
    │  脱敏: 私钥/Token/连接字符串
    │  截断: 按模式限制响应大小
    ▼
tool_result_chunk / tool_error
    │
    ▼
Remote AI (MCP Hub)
```

---

## 七、生产化 TODOs

### P0 — 必须解决（安全/稳定性）

| # | 项目 | 说明 |
|---|------|------|
| 1 | **Token 刷新机制** | 当前 Bearer Token 无自动刷新。长时间运行后 token 过期将导致断连且无法自动恢复。需实现 refresh token 流程或 token 过期前主动续期 |
| 2 | **服务端公钥轮换** | 握手阶段获取的 server public key 无轮换/吊销机制。需支持 key rotation 协议或 key ID 版本化 |
| 3 | **完整的错误恢复** | 断线重连后需要恢复正在执行的 tool call 状态（当前断线 = 丢失进行中的任务），需要 at-least-once 保证 |
| 4 | **进程资源限制** | shell_execute / session_create 无内存/CPU/磁盘 I/O 限制。恶意或失控命令可耗尽整机资源。需加入 cgroup/Job Object 限制 |
| 5 | **并发 tool call 控制** | 当前无并发上限。远端可同时发大量 tool_call 导致 fork bomb。需加入并发队列和速率限制 |
| 6 | **自动更新** | Squirrel.Windows 框架已集成但无实际更新源配置。需要对接更新服务器 (S3/Azure Blob) |

### P1 — 应该解决（可操作性/可观测性）

| # | 项目 | 说明 |
|---|------|------|
| 7 | **结构化遥测** | 当前仅有本地 JSONL 日志。需集成 OpenTelemetry / Application Insights 或类似方案，上报到中央监控 |
| 8 | **审计日志轮转** | JSONL 文件无限增长。需加入大小/时间轮转策略和归档机制 |
| 9 | **健康检查端点** | 提供标准 `/health` 和 `/ready` 接口，供运维监控和负载均衡探针使用 |
| 10 | **CLI 模式（无 GUI）** | 生产环境服务器可能无桌面环境。需支持 headless 模式运行（命令行参数 + 环境变量配置） |
| 11 | **多租户隔离** | 当前单实例绑定单个远端会话。如需支持多 Hub 或多用户，需要会话级隔离 |
| 12 | **配置热加载** | 修改配置文件后需要重启或手动点 Save。应支持 file watch + 自动热加载 |

### P2 — 建议增强（功能完善）

| # | 项目 | 说明 |
|---|------|------|
| 13 | **工具调用超时** | 单个 tool call 执行无全局超时。长时间运行的命令会永远占用连接。需要服务端 + 客户端双侧超时 |
| 14 | **工具结果流式传输** | 当前等待命令完全执行完毕再返回。对于长时间运行命令（编译、测试），应支持流式 result_chunk |
| 15 | **网络代理支持** | 企业环境常需 HTTP/SOCKS 代理。WebSocket 和外部 MCP HTTP 连接需要代理配置 |
| 16 | **外部 MCP 服务器健康监测** | 外部服务器���接后无持续健康检查。应定期 ping 并自动重连断开的服务器 |
| 17 | **工具调用统计面板** | Dashboard 缺少工具调用频率、成功率、平均耗时等指标。对运维和调优有价值 |
| 18 | **RBAC 细化** | 当前三级权限粒度较粗。生产环境可能需要自定义角色（如：只允许 git 命令、只允许读特定目录） |
| 19 | **工具沙箱** | 考虑基于容器（Docker/WSL sandbox）执行命令，提供进程级隔离 |
| 20 | **E2E 测试覆盖** | 当���无自动化测试。需要 WebSocket 协议测试、工具执行测试、权限边界测试 |
| 21 | **国际化完整性** | 部分错误消息仍为硬编码英文字符串。需统一走 i18n |
| 22 | **离线模式** | 断网时应能缓存本地操作，恢复后同步 |
| 23 | **Windows 服务 / macOS LaunchAgent** | 生产部署需要以系统服务方式运行，而非桌面应用 |

### P3 — 技术债务

| # | 项目 | 说明 |
|---|------|------|
| 24 | **CORS 配置** | 当前 `Access-Control-Allow-Origin: *`，生产环境需限制为指定域名 |
| 25 | **HTTP polling 模式清理** | `managed-client` 模式代码仍保留，如确认废弃应移除以减少维护负担 |
| 26 | **配置 Schema 验证** | JSON 配置文件无 Schema 校验。无效配置静默回退默认值，不易排查 |
| 27 | **类型安全增强** | 部分函数使用 `unknown` + 手動类型断言，可用 zod/io-ts 替代 |
| 28 | **依赖更新策略** | 需建立 Dependabot/Renovate 自动更新 + CVE 扫描流程 |

---

## 八、构建与部署

| 项目 | 说明 |
|------|------|
| 构建工具 | Electron Forge + Vite（main/preload/renderer 三独立构建） |
| 打包格式 | Windows: Squirrel (.exe)，macOS: DMG，Linux: Deb/RPM |
| 开发启动 | `npm start` (cli-server) / `npm run start:managed-client-mcp-ws` |
| Lint | `npm run lint` → `tsc --noEmit` |
| 输出 | ASAR 归档（compiled main + preload），Vite SPA (renderer) |

---

## 九、目录结构

```
src/
├── main/                          # Electron Main Process
│   ├── index.ts                   # 入口: 窗口、托盘、IPC、模式选择
│   ├── activity/
│   │   └── logger.ts              # 操作历史日志
│   ├── audit/
│   │   └── logger.ts              # 审计日志
│   ├── builtin-tools/
│   │   └── types.ts               # 权限档位、工具访问控制
│   ├── ipc/
│   │   └── handlers.ts            # IPC 桥接 (Main ↔ Renderer)
│   ├── managed-client/
│   │   ├── admin-tools.ts         # remote_configure_mcp_server 实现
│   │   ├── command-runner.ts      # 任务执行路由 (legacy polling)
│   │   ├── config.ts              # 配置读写与序列化
│   │   ├── mcp-server-config.ts   # 外部 MCP 服务器配置解析
│   │   ├── mcp-tool-registry.ts   # 工具注册中心
│   │   ├── mcp-ws-runtime.ts      # WebSocket 运行时 (主力)
│   │   ├── runtime.ts             # HTTP polling 运行时 (遗留)
│   │   ├── signin.ts              # 浏览器登录流程
│   │   ├── tool-defense.ts        # 工具防御层 (脱敏/截断)
│   │   ├── types.ts               # 类型定义
│   │   └── workspace.ts           # 工作区目录管理
│   ├── mcp/
│   │   └── server.ts              # MCP 工具注册 (shell/file/session/admin)
│   ├── server/
│   │   ├── index.ts               # HTTP/WS 服务器
│   │   ├── http-routes.ts         # HTTP 路由
│   │   ├── ws-handler.ts          # WebSocket CLI 协议
│   │   └── types.ts               # 类型定义
│   └── session/
│       ├── manager.ts             # 会话生命周期管理
│       └── types.ts               # 类型定义
├── preload/
│   └── index.ts                   # Context Bridge (ElectronAPI)
├── renderer/                      # React SPA
│   ├── App.tsx                    # 路由 + 模式选择 + 引导流程
│   ├── main.tsx                   # React 入口
│   ├── components/                # 通用组件 (Card, Badge, Layout...)
│   ├── hooks/
│   │   └── useI18n.tsx            # 国际化 hook
│   ├── pages/                     # 功能页面
│   └── styles/
│       └── index.css              # Tailwind CSS
└── i18n/
    ├── index.ts                   # locale 加载器
    ├── en.json                    # 英文
    └── zh-CN.json                 # 简体中文

docs/                              # 文档
managed-client.config.json         # 运行时配置
managed-client.mcp-servers.json    # 外部 MCP 服务器配置
```
