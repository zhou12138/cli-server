# 🏮 LandGod — 从零开始搭建指南

> AI Agent 远程设备管理系统。让你的 AI 一句话控制所有机器。

---

## 架构概览

```
AI Agent (任意智能体)
  │
  │ HTTP POST http://localhost:8081/tool_call
  │
  ▼
LandGod-Link Gateway (边车服务)
  │
  │ WebSocket + Ed25519 签名
  │
  ├──► LandGod Worker A (Linux)
  ├──► LandGod Worker B (Windows)
  └──► LandGod Worker C (Mac)
```

**三个角色：**

| 角色 | 说明 | 安装在哪 |
|------|------|---------|
| **AI Agent** | 你的 AI（OpenClaw / ChatGPT / Claude / LangChain …） | Agent 机器 |
| **LandGod-Link** | Gateway 边车服务，接收 Agent 指令转发给 Worker | Agent 同一台机器 |
| **LandGod Worker** | 远程执行节点，接收并执行指令 | 远程设备 |

---

## 前置要求

- **Node.js 18+**（推荐 22）
- **网络**：Agent 机器能访问 GitHub（下载安装包）

---

## Part 1：搭建 Gateway（Agent 机器上操作）

> 在你的 AI Agent 所在的机器上执行。

### Step 1：安装 LandGod-Link Gateway

```bash
npm install -g https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod-link-0.1.0.tgz
```

### Step 2：启动 Gateway

```bash
# 后台启动（推荐）
landgod-link start --daemon

# 或前台启动（调试用）
landgod-link start
```

### Step 3：验证 Gateway

```bash
landgod-link status
```

预期输出：
```
Gateway: running (pid xxxxx)
Connected Workers: 0
Registered Tokens: 1
```

### Step 4：确认 API 可用

```bash
curl -s http://localhost:8081/health
```

预期输出：
```json
{"status":"ok","connectedClients":0,"registeredTokens":1,"wsPort":8080,"httpPort":8081}
```

✅ **Gateway 就绪！Agent 现在可以调用 `http://localhost:8081` 了。**

---

## Part 2：添加 Worker（远程设备上操作）

> 在每台需要被管理的远程机器上执行。

### 方式 A：手动安装（在远程机器上操作）

#### Step 1：安装 LandGod Worker

```bash
npm install -g https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/cli-server-0.1.0.tgz
```

#### Step 2：选择运行模式

LandGod 支持两种运行模式：

| 模式 | 需要 Electron | 需要系统依赖 | 适合场景 |
|------|-------------|-------------|---------|
| **Headless (推荐)** | ❌ 不需要 | ❌ 不需要 | 服务器、CLI、跨平台 |
| **Electron** | ✅ ~170MB | ✅ libgtk, xvfb... | 需要 UI 界面时 |

**选择 A：Headless 模式（推荐，纯 Node.js）**

无需额外安装，直接跳到 Step 5 配置。

**选择 B：Electron 模式（需要 UI 时）**

```bash
# 安装 Electron 依赖
cd $(node -e "console.log(require.resolve('cli-server/package.json').replace('/package.json',''))")
npm install

# 安装系统依赖（Linux）
sudo apt-get install -y libgtk-3-0 libnss3 libasound2t64 libcups2 xvfb
```

#### Step 3：启动虚拟显示（仅 Electron 模式 + Linux headless 服务器）

```bash
Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99
```

> 💡 Headless 模式不需要此步骤。

#### Step 4：（已合并到 Step 2）

#### Step 5：配置连接

```bash
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "ws://<GATEWAY_IP>:8080"
landgod config set token "hardcoded-token-1234"
landgod config set toolCallApprovalMode auto
landgod config set builtInTools.permissionProfile full-local-admin
landgod config set builtInTools.shellExecute.enabled true
landgod config set builtInTools.shellExecute.allowedExecutableNames '["git","node","npm","npx","python","python3","echo","ls","cat","whoami","hostname","uname","pwd","curl"]'
landgod config set builtInTools.shellExecute.allowedWorkingDirectories '["/home/<YOUR_USER>","/tmp"]'
```

> ⚠️ 将 `<GATEWAY_IP>` 替换为 Gateway 机器的 IP，`<YOUR_USER>` 替换为当前用户名。
> 如果 Worker 和 Gateway 在同一台机器，用 `ws://localhost:8080`。

#### Step 6：启动 Worker

```bash
# Headless 模式（推荐，无需 Electron）
landgod daemon start --headless

# 或 Electron 模式
landgod daemon start
```

> 💡 Headless 模式下，Worker 使用纯 Node.js 运行，不需要 Electron、xvfb、libgtk 等依赖。
> 支持 Linux、macOS、Windows 三平台。

#### Step 7：验证

在 Gateway 机器上执行：
```bash
curl -s http://localhost:8081/clients
```

应该能看到新设备出现。

---

### 方式 B：自动部署（在 Gateway 机器上操作）

> 适合批量部署，只需知道远程机器的 IP 和 SSH 密码。

#### Step 1：准备部署密钥（仅首次）

```bash
ssh-keygen -t ed25519 -f ~/.ssh/landgod_deploy -N "" -C "landgod-deploy"
```

#### Step 2：一键部署

```bash
# 下载部署脚本
curl -fsSL -o /tmp/landgod-deploy.sh https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/scripts/landgod-deploy.sh
chmod +x /tmp/landgod-deploy.sh

# 执行部署
/tmp/landgod-deploy.sh <IP> <SSH用户名> <SSH密码> [设备名]

# 示例
/tmp/landgod-deploy.sh 20.2.89.92 ZhouTest4 "mypassword" ZhouTest4
```

脚本自动完成：
1. SSH 连接新机器
2. 注入部署密钥（后续不需要密码）
3. 从 GitHub 下载安装 LandGod Worker
4. 安装系统依赖
5. 写入配置
6. 建立反向 SSH 隧道
7. 注册 systemd 服务（开机自启）
8. 启动 Worker
9. 验证连接
10. 焚毁密码 🔥

---

## Part 3：网络连接方式

Worker 需要能访问 Gateway 的 WebSocket 端口（默认 8080）。根据你的网络环境选择合适的方案。

### 网络环境总览

```
┌─────────────────────────────────────────────────────────────┐
│                    Gateway 位置                              │
│              公网          内网A          内网B              │
│  Worker ┌──────────┬──────────────┬──────────────┐         │
│  位置   │          │              │              │         │
│  同机器 │ ① 直连   │  ① 直连      │  ① 直连      │         │
│  公网   │ ② 直连   │  ⑤ 需穿透    │  ⑤ 需穿透    │         │
│  内网A  │ ② 直连   │  ③ 局域网    │  ⑤ 需穿透    │         │
│  内网B  │ ② 直连   │  ⑤ 需穿透    │  ③/⑤        │         │
│         └──────────┴──────────────┴──────────────┘         │
└─────────────────────────────────────────────────────────────┘

① 直连 localhost    — 零配置
② 直连公网 IP       — 开放端口即可
③ 局域网直连        — 同一网段内直连
④ SSH 隧道         — 一端有公网即可
⑤ 需要穿透         — 双方都在 NAT 后面
```

---

### 场景 ①：同一台机器

> Gateway 和 Worker 在同一台机器上

```
┌─────────────────┐
│ Gateway :8080   │
│ Worker          │ → ws://localhost:8080
└─────────────────┘
```

配置：
```bash
landgod config set bootstrapBaseUrl "ws://localhost:8080"
```

**最简单，零网络配置。**

---

### 场景 ②：Worker 能直接访问 Gateway 公网 IP

> Gateway 有公网 IP，Worker 能访问到

```
Worker ──── 公网 ────► Gateway (公网 IP)
                       20.205.20.239:8080
```

配置：
```bash
landgod config set bootstrapBaseUrl "ws://20.205.20.239:8080"
```

⚠️ 需要确保 Gateway 的 8080 端口对外开放（云服务器需配置安全组/防火墙）。

---

### 场景 ③：同一局域网

> Gateway 和 Worker 在同一个局域网（同一 VPC、同一 WiFi、同一办公网络）

```
局域网 192.168.1.0/24
┌──────────────┐        ┌──────────────┐
│ Gateway      │◄───────│ Worker       │
│ 192.168.1.50 │  直连   │ 192.168.1.100│
└──────────────┘        └──────────────┘
```

配置：
```bash
landgod config set bootstrapBaseUrl "ws://192.168.1.50:8080"
```

**同一网段内直连，无需穿透。** 包括：
- 同一 Azure/AWS VPC 内的虚拟机
- 同一办公室的电脑
- 同一家庭网络的设备

---

### 场景 ④：跨网络（一端有公网）— SSH 隧道

> Gateway 有公网 IP，Worker 在内网；或反过来。

**方式 A：正向隧道（Worker 主动连 Gateway）**

```
内网 Worker → ssh -L 8080:localhost:8080 → 公网 Gateway
Worker 配置: ws://localhost:8080
```

```bash
# 在 Worker 机器上执行
ssh -L 8080:localhost:8080 user@GATEWAY_PUBLIC_IP
landgod config set bootstrapBaseUrl "ws://localhost:8080"
```

**方式 B：反向隧道（Gateway 主动推给 Worker）**

```
公网 Gateway → ssh -R 8080:localhost:8080 → 内网 Worker
Worker 配置: ws://localhost:8080
```

```bash
# 在 Gateway 机器上执行
ssh -R 8080:localhost:8080 user@WORKER_IP
```

Worker 不需要知道 Gateway 在哪，通过 localhost 访问隧道。

---

### 场景 ⑤：双方都在内网（NAT 穿透）

> Gateway 和 Worker 都在不同的内网，没有公网 IP，互相访问不到。

```
内网 A                              内网 B
┌──────────┐   ❌ 互不可达   ┌──────────┐
│ Gateway  │                  │ Worker   │
│ NAT 后面 │                  │ NAT 后面 │
└──────────┘                  └──────────┘
```

**需要第三方中继。以下方案任选其一：**

#### 方案 A：Cloudflare Tunnel（推荐 🌟）

> 只需在 Gateway 端安装 cloudflared，免费，自动 TLS 加密。

```
内网 A                 Cloudflare              内网 B
┌──────────┐          ┌────────┐             ┌──────────┐
│ Gateway  │─────────►│  CF    │◄────────────│ Worker   │
│cloudflared│ 主动连出  │  Edge  │  公网 URL    │ 连公网URL│
└──────────┘          └────────┘             └──────────┘
```

Gateway 端：
```bash
# 安装 cloudflared
curl -fsSL https://pkg.cloudflare.com/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb

# 启动隧道（自动生成公网 URL）
cloudflared tunnel --url ws://localhost:8080
# 输出: https://xxx-yyy-zzz.trycloudflare.com
```

Worker 端：
```bash
landgod config set bootstrapBaseUrl "wss://xxx-yyy-zzz.trycloudflare.com"
```

✅ 免费、零端口开放、自动 TLS、两端都是主动向外连接。

#### 方案 B：Tailscale

> 两端安装 Tailscale，自动组建 VPN 网络。

```
Gateway (100.64.x.x) ◄─── WireGuard VPN ───► Worker (100.64.y.y)
```

两端：
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Worker 端：
```bash
landgod config set bootstrapBaseUrl "ws://100.64.x.x:8080"
```

✅ 加密、NAT 穿透、设备自动发现。需要两端都安装。

#### 方案 C：ngrok

> 只需在 Gateway 端安装，自动生成公网 URL。

Gateway 端：
```bash
ngrok http 8080
# 输出: https://xxxx.ngrok.io
```

Worker 端：
```bash
landgod config set bootstrapBaseUrl "wss://xxxx.ngrok.io"
```

⚠️ 免费版有连接数限制和 URL 变化。

#### 方案 D：FRP（自建穿透）

> 需要一台有公网 IP 的中继服务器。

```
内网 Gateway → frpc → 公网 VPS (frps) ← frpc ← 内网 Worker
```

适合长期稳定使用，但需要自己维护中继服务器。

---

### 方案选择指南

| 你的情况 | 推荐方案 | 理由 |
|---------|---------|------|
| 同机器 | ① 直连 localhost | 零配置 |
| 同局域网 | ③ 内网 IP 直连 | 零配置 |
| Gateway 有公网 IP | ② 直连公网 | 简单 |
| 一端有公网 | ④ SSH 隧道 | 无需额外软件 |
| 都在内网（临时使用） | ⑤A Cloudflare Tunnel | 免费、一分钟搞定 |
| 都在内网（长期使用） | ⑤B Tailscale | 最稳定 |

---

## Part 4：告诉你的 Agent

Gateway 启动后，把以下信息告诉你的 AI Agent：

```
你可以通过 HTTP 调用 http://localhost:8081 管理远程设备。

可用接口：
- GET  /health              健康检查
- GET  /clients             列出在线设备
- POST /tool_call           向设备发送指令
- POST /tokens              创建设备 Token
- GET  /tokens              列出 Token
- DELETE /tokens/:token     吊销 Token

执行命令示例：
POST http://localhost:8081/tool_call
Content-Type: application/json

{
  "tool_name": "shell_execute",
  "arguments": {"command": "hostname"},
  "timeout": 10000
}

指定设备执行：
{
  "tool_name": "shell_execute",
  "arguments": {"command": "hostname"},
  "connection_id": "conn-xxx"
}
```

Agent 用自带的 HTTP 能力调用即可，**不需要安装任何 SDK**。

---

## Part 5：常用操作

### 查看在线设备

```bash
curl -s http://localhost:8081/clients | python3 -m json.tool
```

### 在指定设备执行命令

```bash
curl -s -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"shell_execute","arguments":{"command":"hostname && uname -a"}}'
```

### 创建设备专属 Token

```bash
curl -s -X POST http://localhost:8081/tokens \
  -H "Content-Type: application/json" \
  -d '{"device_name":"my-new-device"}'
```

### 吊销 Token

```bash
curl -s -X DELETE http://localhost:8081/tokens/tok_xxxx
```

### Gateway 管理

```bash
landgod-link status     # 查看状态
landgod-link stop       # 停止
landgod-link start      # 启动
```

### Worker 管理

```bash
landgod health          # 查看健康状态
landgod daemon stop     # 停止
landgod daemon start    # 启动
landgod config show     # 查看配置
landgod audit log       # 查看审计日志
```

---

## 完整示例：从零到远程执行

```bash
# === Agent 机器上 ===

# 1. 安装并启动 Gateway
npm install -g https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod-link-0.1.0.tgz
landgod-link start --daemon

# 2. 部署远程 Worker（需要远程机器的 SSH 信息）
ssh-keygen -t ed25519 -f ~/.ssh/landgod_deploy -N ""
curl -fsSL -o /tmp/landgod-deploy.sh https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/scripts/landgod-deploy.sh
chmod +x /tmp/landgod-deploy.sh
/tmp/landgod-deploy.sh 20.2.89.92 user "password" my-server

# 3. 验证
curl -s http://localhost:8081/clients

# 4. 远程执行
curl -s -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"shell_execute","arguments":{"command":"echo hello from LandGod"}}'

# 输出: hello from LandGod
```

---

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `landgod-link: command not found` | 运行 `hash -r` 刷新 shell 缓存 |
| Gateway 启动失败 `EADDRINUSE` | 端口被占用：`fuser -k 8080/tcp; fuser -k 8081/tcp` |
| Worker 连不上 Gateway | 检查网络/隧道：`curl http://localhost:8080`（应返回 `Upgrade Required`）|
| `Electron is not installed` | 使用 `--headless` 模式，或在 Worker 安装目录执行 `npm install` |
| `Missing X server` | 使用 `--headless` 模式，或安装 xvfb: `sudo apt install xvfb && Xvfb :99 &` |
| 命令被拒绝 `outside the allowlist` | 用 `landgod config set` 添加命令到白名单 |

---

## 安全说明

- 所有 tool_call 指令使用 **Ed25519 数字签名**，防伪造/篡改/重放
- Worker 有**命令白名单**和**目录限制**
- 支持**设备专属 Token**，可随时吊销
- 部署时 SSH 密码**用完即焚**，后续通过密钥+WebSocket 通信
- 所有操作记录在 **audit.jsonl** 审计日志中

---

_LandGod — 土地公守护你的每一台机器 🏮_
