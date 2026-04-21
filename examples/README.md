# 📂 Examples

LandGod 使用示例和模板。

---

## 🌐 实战部署案例：多云跨境集群管理

基于 OpenClaw 多 Agent 协作 + LandGod 远程设备管理的完整部署案例。

### 网络拓扑

```
                          ┌──────────────────────────────────────────┐
                          │         ZhouTest1 (Azure 美西)           │
                          │         20.205.20.239                    │
                          │                                          │
                          │  ┌─ landgod-gateway-py (Python) ────┐   │
                          │  │  HTTP API    :8081                │   │
                          │  │  WebSocket   :8080                │   │
                          │  │  systemd 保活                     │   │
                          │  └──────────────────────────────────┘   │
                          │                                          │
                          │  ┌─ landgod worker (headless) ──────┐   │
                          │  │  1号土地公 · ws://localhost:8080   │   │
                          │  │  Node.js 纯 headless 模式         │   │
                          │  └──────────────────────────────────┘   │
                          │                                          │
                          │  ┌─ OpenClaw Gateway ───────────────┐   │
                          │  │  悟空🐒 / 夜游神👁️ / 太白金星🌟    │   │
                          │  │  / 二郎神👁‍🗨 (4 个 AI Agent)      │   │
                          │  └──────────────────────────────────┘   │
                          │                                          │
                          │  autossh 反向隧道 ────────┐              │
                          │  cloudflare quick tunnel ──┼──┐          │
                          └────────────────────────────┼──┼──────────┘
                                                       │  │
                    ┌──────────────────────────────┐   │  │   ┌────────────────────────────┐
                    │    ZhouTest4 (Azure 美西)     │   │  │   │   阿里云 (北京)              │
                    │    20.2.89.92                 │◄──┘  └──►│   39.105.220.11             │
                    │                              │           │                            │
                    │  landgod worker (headless)    │           │  landgod worker (headless)  │
                    │  ws://localhost:8080          │           │  wss://xxx.trycloudflare..  │
                    │  ← SSH 反向隧道回 ZhouTest1   │           │  ← Cloudflare Tunnel 穿透   │
                    │                              │           │                            │
                    │  fail2ban 已启用              │           │  GFW 穿透                   │
                    └──────────────────────────────┘           └────────────────────────────┘
```

### 连接方式对比

| 土地公 | 连接方式 | 延迟 | 稳定性 | 适用场景 |
|--------|---------|------|--------|---------|
| 1号 (本机) | `ws://localhost:8080` 直连 | <1ms | ⭐⭐⭐⭐⭐ | Gateway 同机 |
| 4号 (Azure) | SSH 反向隧道 + autossh | ~2ms | ⭐⭐⭐⭐ | 同云/同网段 |
| 阿里云 (北京) | Cloudflare Quick Tunnel (wss://) | ~20ms | ⭐⭐⭐ | 跨境/GFW 穿透 |

### 安装步骤

**1. Gateway（在中心节点安装）**

```bash
# Python 版 Gateway（支持单机和分布式集群）
pip install https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod_gateway_server-0.1.1-py3-none-any.whl

# 启动（单机模式）
landgod-gateway-py start

# 启动（Redis 集群模式）
landgod-gateway-py start --redis redis://redis-host:6379
```

**2. Worker（在每台被管设备上安装）**

```bash
# 安装
npm install -g https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod-0.1.1.tgz

# 配置
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "ws://GATEWAY_ADDRESS:8080"
landgod config set token "YOUR_TOKEN"
landgod config set toolCallApprovalMode auto
landgod config set builtInTools.permissionProfile full-local-admin

# 启动（headless 模式，推荐服务器使用）
landgod daemon start --headless

# 启动（GUI 模式，Windows/Mac 桌面使用）
landgod daemon start
```

**3. 跨网络连接方案**

```bash
# 方案 A：SSH 反向隧道（同云/VPN 可达）
# 在中心节点运行：
autossh -M 0 -N -R 8080:localhost:8080 user@remote-worker

# 方案 B：Cloudflare Tunnel（跨境/GFW 穿透）
# 在中心节点运行：
cloudflared tunnel --url http://localhost:8080
# Worker 端使用 wss:// 地址连接

# 方案 C：直连公网（需开放端口）
# Worker 直接连 ws://PUBLIC_IP:8080
```

**4. systemd 保活**

```bash
# Gateway 保活
sudo systemctl enable landgod-python-gateway

# SSH 隧道保活
sudo systemctl enable landgod-tunnel-t4

# Worker 保活（cron 每分钟检查）
* * * * * /path/to/worker-keepalive.sh
```

---

## 🤖 OpenClaw 多 Agent 协作

当前部署中有 4 个 AI Agent 通过 Discord 协作管理土地公集群：

### Agent 阵容

| Agent | 角色 | 职责 |
|-------|------|------|
| 🐒 **悟空** (main) | 开发运维 | 写代码、部署 Worker、修 Bug、打包发布 |
| 👁️ **夜游神** (patrol) | 巡视员 | 定期巡查土地公状态、安全扫描、发现异常报警 |
| 🌟 **太白金星** (taibai) | 通道管理 | SSH 凭据保管、隧道重建、Worker 进程恢复 |
| 👁‍🗨 **二郎神** (erlang) | 任务调度 | 向土地公下发批量任务、收集结果、汇报 |

### 协作流程

```
夜游神巡查发现异常
    ↓
@ 太白金星修通道 / @ 悟空修代码
    ↓
太白金星 SSH 上去重启 Worker / 悟空修 Bug 重新部署
    ↓
夜游神再次巡查确认恢复
    ↓
二郎神下发批量任务验证功能
```

### Agent 与 LandGod 的交互

```bash
# 二郎神下发任务（通过 Gateway HTTP API）
curl -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{
    "clientName": "ZhouTest4",
    "tool_name": "shell_execute",
    "arguments": {"command": "hostname && uname -a"}
  }'

# 夜游神安全扫描（对每台土地公执行）
curl -X POST http://localhost:8081/tool_call \
  -d '{
    "clientName": "ZhouTest1",
    "tool_name": "shell_execute",
    "arguments": {"command": "ps aux | grep -iE miner|xmrig|crypto"}
  }'

# Python SDK 批量操作
from landgod_gateway import LandGod
link = LandGod('http://localhost:8081')
results = await link.broadcast('hostname')
```

### 实测数据

| 土地公 | 百度延迟 (100次平均) | 连通率 |
|--------|---------------------|--------|
| 🏮 1号 (Azure 美西) | 20ms | 100% |
| 🏮 4号 (Azure 美西) | 22ms | 100% |
| 🏮 阿里云 (北京) | 10ms | 100% |

---

## config-templates/

Worker 配置文件模板。

| 文件 | 权限级别 | 适合场景 |
|------|---------|---------|
| `managed-client.config.json` | command-only | 只读巡检 |
| `managed-client.full-admin.config.json` | full-local-admin | 完整管理 |

使用前替换占位符：
- `REPLACE_WITH_UUID` — 设备唯一 ID
- `REPLACE_WITH_DEVICE_NAME` — 设备名称
- `REPLACE_WITH_GATEWAY` — Gateway 地址
- `REPLACE_WITH_TOKEN` — 认证 Token
- `REPLACE_WITH_USER` — 系统用户名
