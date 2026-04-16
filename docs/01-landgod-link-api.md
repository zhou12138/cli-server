# LandGod-Link API 参考

## 定位

LandGod-Link 是 Agent 的 **Sidecar Gateway**，部署在 Agent 同机器上，提供两个端口：

| 端口 | 协议 | 服务对象 | 用途 |
|------|------|---------|------|
| **8081** (HTTP) | REST API | **AI Agent** | Agent 通过此端口发送指令、查询设备 |
| **8080** (WebSocket) | WS | **LandGod Worker** | Worker 通过此端口连接 Gateway |

```
AI Agent ──HTTP:8081──► LandGod-Link ◄──WS:8080── LandGod Worker
```

**Agent 只需要知道 `http://localhost:8081`，Worker 只需要知道 `ws://GATEWAY:8080`。**

---

## Agent 端接口 (HTTP :8081)

### GET /health

健康检查。

**响应**:
```json
{
  "status": "ok",
  "connectedClients": 2,
  "registeredTokens": 3,
  "wsPort": 8080,
  "httpPort": 8081
}
```

### GET /clients

列出所有在线 Worker。

**响应**:
```json
{
  "clients": [
    {
      "connectionId": "conn-xxx",
      "clientId": "uuid",
      "clientName": "ZhouTest1",
      "sessionId": "session-xxx",
      "connected": true
    }
  ]
}
```

### POST /tool_call

向 Worker 发送工具调用。

**请求**:
```json
{
  "tool_name": "shell_execute",
  "arguments": { "command": "hostname" },
  "connection_id": "conn-xxx",
  "timeout": 10000
}
```

- `tool_name`: 必填。可用工具见 Worker 能力。
- `arguments`: 必填。工具参数。
- `connection_id`: 可选。不填则自动选择第一个在线 Worker。
- `timeout`: 可选。超时毫秒数，默认 30000。

**响应（成功）**:
```json
{
  "type": "event",
  "event": "tool_result_chunk",
  "payload": {
    "request_id": "tool_call-xxx",
    "data": {
      "text": "{\"stdout\":\"ZhouTest1\\n\",\"stderr\":\"\",\"exit_code\":0}"
    },
    "is_final": false
  }
}
```

**响应（失败）**:
```json
{
  "type": "event",
  "event": "tool_error",
  "payload": {
    "request_id": "tool_call-xxx",
    "error": {
      "code": "tool_execution_failed",
      "message": "Executable is outside the allowlist: rm",
      "retryable": false
    }
  }
}
```

### POST /tokens

创建设备专属 Token。

**请求**:
```json
{ "device_name": "my-server" }
```

**响应**:
```json
{
  "token": "tok_abc123...",
  "device_name": "my-server",
  "created_at": "2026-04-15T10:00:00Z"
}
```

### GET /tokens

列出所有 Token。

### DELETE /tokens/:token

吊销 Token。吊销后使用该 Token 的 Worker 会被立即断开。

---

## Worker 端接口 (WebSocket :8080)

Worker 连接 `ws://GATEWAY:8080/api/mcphub/ws`，使用 Bearer Token 认证。

### 连接握手

```
1. Worker → Gateway: WebSocket 连接 + Authorization: Bearer <token>
2. Gateway → Worker: { type: "event", event: "session_opened", payload: { connection_id } }
3. Worker → Gateway: { type: "req", method: "register", params: { client_id, client_name } }
4. Gateway → Worker: { type: "res", ok: true, payload: { user_id, session_id, server_public_key, ... } }
5. Worker → Gateway: { type: "req", method: "update_tools", params: { tools: {...} } }
6. Gateway → Worker: { type: "res", ok: true, payload: { accepted: true } }
```

### 指令执行

```
7. Gateway → Worker: { type: "req", method: "tool_call", params: { tool_name, arguments, meta: { signature, ... } } }
8. Worker → Gateway: { type: "event", event: "tool_result_chunk", payload: { data, is_final } }
```

---

## Node.js 版本

### 安装
```bash
npm install -g landgod-gateway-0.1.0.tgz
```

### CLI
```bash
landgod-gateway start [--daemon] [--port 8081] [--ws-port 8080]
landgod-gateway stop
landgod-gateway status
```

### 配置
环境变量：
- `LANDGOD_HTTP_PORT` — HTTP 端口（默认 8081）
- `LANDGOD_WS_PORT` — WebSocket 端口（默认 8080）
- `LANDGOD_DATA_DIR` — 数据目录（默认 ~/.landgod-gateway）
- `LANDGOD_AUTH_TOKEN` — 默认认证 Token

---

## Python 版本

### 安装
```bash
pip install landgod_gateway-0.1.0-py3-none-any.whl
pip install landgod-gateway[redis]  # 可选 Redis 支持
```

### 使用
```python
from landgod_gateway import LandGod

# 单机模式
link = LandGod('http://localhost:8081', store='memory')

# 分布式模式（多 Agent 共享状态）
link = LandGod('http://localhost:8081', store='redis://localhost:6379')

# 查看设备
clients = link.clients_sync()

# 执行命令
result = link.execute_sync('hostname', target='ZhouTest1')

# 广播
results = link.broadcast_sync('uname -a')

# Token 管理
token = await link.create_token('new-device')
await link.revoke_token('tok_xxx')
```

### 状态存储

| 模式 | 后端 | 适合场景 |
|------|------|---------|
| `memory` | 内存 | 单 Agent 单机 |
| `redis://...` | Redis | 多 Agent 分布式 |

自动记录执行历史和统计到 store 中。
