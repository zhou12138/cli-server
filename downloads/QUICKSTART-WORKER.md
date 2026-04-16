# 🚀 快速开始：安装 Worker（土地公）

> Worker（landgod）是远程执行节点，部署在需要被管理的设备上。

> **前置条件**：确保本机能访问 Gateway 的 8080 端口（`ws://GATEWAY:8080`）。不同网络环境的配置见 [docs/00-network-prerequisites.md](../docs/00-network-prerequisites.md)。

## 一键安装

```bash
npm install -g https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod-0.1.0.tgz
```

## 选择运行模式

| 模式 | 需要 Electron | 适合场景 |
|------|-------------|---------|
| **Headless（推荐）** | ❌ | 服务器、CLI、跨平台 |
| **Electron** | ✅ (~170MB) | 需要 UI 界面 |

Headless 模式无需额外安装，直接配置即可。

Electron 模式需要：
```bash
cd $(node -e "console.log(require.resolve('landgod/package.json').replace('/package.json',''))")
npm install
# Linux 还需要: sudo apt-get install -y libgtk-3-0 libnss3 libasound2t64 libcups2 xvfb
```

## 配置

### 基础模式（最小权限，推荐）

```bash
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "ws://<GATEWAY_ADDRESS>:8080"
landgod config set token "hardcoded-token-1234"
landgod config set toolCallApprovalMode auto
landgod config set builtInTools.permissionProfile command-only
landgod config set builtInTools.shellExecute.enabled true
landgod config set builtInTools.shellExecute.allowedExecutableNames '["echo","ls","cat","whoami","hostname","uname","pwd"]'
landgod config set builtInTools.shellExecute.allowedWorkingDirectories '["/tmp"]'
```

### 开发模式（常用工具）

```bash
landgod config set builtInTools.permissionProfile interactive-trusted
landgod config set builtInTools.shellExecute.allowedExecutableNames '["git","node","npm","npx","python","python3","echo","ls","cat","whoami","hostname","uname","pwd","curl","free","df","ps","nproc","grep","wc"]'
landgod config set builtInTools.shellExecute.allowedWorkingDirectories '["/home/<USER>","/tmp"]'
```

### 管理员模式（完整权限）

```bash
landgod config set builtInTools.permissionProfile full-local-admin
landgod config set builtInTools.shellExecute.allowedExecutableNames '["git","node","npm","npx","python","python3","echo","ls","cat","whoami","hostname","uname","pwd","curl","free","df","ps","nproc","grep","wc","mkdir","rm","cp","mv"]'
landgod config set builtInTools.shellExecute.allowedWorkingDirectories '["/home/<USER>","/tmp","/var"]'
```

> ⚠️ **不要** 把 `bash`、`sh` 加到白名单——它们会绕过所有命令限制。

## 替换占位符

- `<GATEWAY_ADDRESS>` — Gateway 机器地址（同机用 `localhost`，局域网用内网 IP）
- `<USER>` — 当前用户名

## 启动

```bash
# Headless 模式（推荐）
landgod daemon start --headless

# Electron 模式
landgod daemon start
```

## 验证

在 Gateway 机器上：
```bash
curl -s http://localhost:8081/clients
```

## 网络连接

Worker 需要能访问 Gateway 的 WebSocket 端口（默认 8080）。

| 场景 | 配置 |
|------|------|
| 同一台机器 | `ws://localhost:8080` |
| 同一局域网 | `ws://内网IP:8080` |
| 跨网络 | SSH 隧道 / Cloudflare Tunnel / Tailscale |

详见 [docs/00-network-prerequisites.md](../docs/00-network-prerequisites.md)

## 自动部署（可选）

在 Gateway 机器上运行部署脚本，自动安装到远程设备：

```bash
./scripts/landgod-deploy.sh <IP> <用户名> <密码> [设备名]
```

## 故障排查

| 问题 | 解决 |
|------|------|
| `Electron is not installed` | 用 `--headless` 模式 |
| `Missing X server` | 用 `--headless` 模式 |
| `command not found` | 运行 `hash -r` |
| 连不上 Gateway | 检查网络/隧道 |

## 下一步

→ 详细文档见 [docs/](../docs/)
