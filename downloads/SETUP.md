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

#### Step 2：安装 Electron 依赖

```bash
cd $(node -e "console.log(require.resolve('cli-server/package.json').replace('/package.json',''))")
npm install
```

#### Step 3：安装系统依赖（Linux）

```bash
sudo apt-get install -y libgtk-3-0 libnss3 libasound2t64 libcups2 xvfb
```

#### Step 4：启动虚拟显示（Linux headless 服务器）

```bash
Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99
```

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
landgod daemon start
```

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

Worker 需要能访问 Gateway 的 WebSocket 端口（默认 8080）。

### 场景 1：同一台机器 / 同一局域网

```
Worker → ws://GATEWAY_IP:8080     直接连接
```

配置：
```bash
landgod config set bootstrapBaseUrl "ws://192.168.1.100:8080"
```

### 场景 2：跨网络（SSH 隧道）

```
Gateway 机器 → ssh -R 8080:localhost:8080 → Worker 机器
Worker → ws://localhost:8080
```

配置：
```bash
landgod config set bootstrapBaseUrl "ws://localhost:8080"
```

### 场景 3：跨网络（Cloudflare Tunnel）

```
Gateway → cloudflared → wss://xxx.trycloudflare.com
Worker → wss://xxx.trycloudflare.com
```

### 场景 4：跨网络（Tailscale）

```
Gateway (100.x.x.x) ↔ Worker (100.y.y.y)
Worker → ws://100.x.x.x:8080
```

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
| `Electron is not installed` | 在 Worker 安装目录执行 `npm install` |
| `Missing X server` | 安装 xvfb：`sudo apt install xvfb && Xvfb :99 &` |
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
