# LandGod Managed Client MCP-WS 协议

## 概述

LandGod Worker（managed-client-mcp-ws）通过 WebSocket 与 Gateway 通信。协议基于 JSON 消息，包含连接管理、工具注册、指令执行三个阶段。

## 消息格式

所有消息为 JSON，包含 `type` 字段：

| type | 方向 | 说明 |
|------|------|------|
| `event` | Gateway → Worker | 事件通知 |
| `req` | 双向 | 请求 |
| `res` | 双向 | 响应 |

## 阶段一：连接建立

### 1.1 WebSocket 连接

```
Worker → wss://GATEWAY:8080/api/mcphub/ws
Headers:
  Authorization: Bearer <token>
```

### 1.2 session_opened

Gateway 接受连接后立即发送：

```json
{
  "type": "event",
  "event": "session_opened",
  "payload": {
    "connection_id": "conn-uuid"
  }
}
```

Worker 必须在 10 秒内收到此事件，否则超时断开。

## 阶段二：注册与工具上报

### 2.1 register

Worker 发送注册请求：

```json
{
  "type": "req",
  "id": "register-uuid",
  "method": "register",
  "params": {
    "client_id": "worker-uuid",
    "client_name": "ZhouTest1"
  }
}
```

Gateway 响应（**所有字段必填**）：

```json
{
  "type": "res",
  "id": "register-uuid",
  "ok": true,
  "payload": {
    "user_id": "user-uuid",
    "client_id": "worker-uuid",
    "connection_id": "conn-uuid",
    "session_id": "session-uuid",
    "server_key_id": "key-uuid",
    "server_public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "server_time": "2026-04-15T10:00:00.000Z"
  }
}
```

**注意**：
- `server_public_key` 必须是有效的 PEM 格式密钥（Ed25519 推荐）
- `connection_id` 必须与 session_opened 中的一致
- `server_time` 必须是 ISO 8601 格式

### 2.2 update_tools

Worker 上报所有可用工具：

```json
{
  "type": "req",
  "id": "update_tools-uuid",
  "method": "update_tools",
  "params": {
    "reset": true,
    "tools": {
      "shell_execute": {
        "name": "shell_execute",
        "description": "Execute a shell command...",
        "input_schema": { "type": "object", "properties": { "command": { "type": "string" } } }
      },
      "playwright.browser_navigate": { ... }
    }
  }
}
```

Gateway 响应：
```json
{ "type": "res", "id": "update_tools-uuid", "ok": true, "payload": { "accepted": true } }
```

## 阶段三：指令执行

### 3.1 tool_call（Gateway → Worker）

```json
{
  "type": "req",
  "id": "tool_call-uuid",
  "method": "tool_call",
  "params": {
    "tool_name": "shell_execute",
    "arguments": { "command": "hostname" },
    "meta": {
      "schema_version": "1.0",
      "request_id": "tool_call-uuid",
      "user_id": "user-uuid",
      "client_id": "worker-uuid",
      "connection_id": "conn-uuid",
      "session_id": "session-uuid",
      "key_id": "key-uuid",
      "nonce": "random-uuid",
      "body_sha256": "base64url-hash",
      "iat": "2026-04-15T10:00:00.000Z",
      "exp": "2026-04-15T10:01:00.000Z",
      "signature": "base64url-ed25519-signature"
    }
  }
}
```

### 3.2 签名验证

Worker 验证每条 tool_call 的签名：

1. 检查 `user_id`、`client_id`、`connection_id`、`session_id`、`key_id` 与注册时一致
2. 检查 `iat`/`exp` 在时间窗口内（±30秒）
3. 检查 `nonce` 未被重放
4. 计算 `body_sha256 = base64url(sha256(canonicalize({ tool_name, arguments })))`
5. 验证 `signature`：`verify(null, canonicalize(signaturePayload), serverPublicKey, base64urlDecode(signature))`

`canonicalize` = JSON.stringify with sorted keys。

### 3.3 tool_result（Worker → Gateway）

```json
{
  "type": "event",
  "event": "tool_result_chunk",
  "payload": {
    "request_id": "tool_call-uuid",
    "data": { "text": "{\"stdout\":\"ZhouTest1\\n\",\"stderr\":\"\",\"exit_code\":0}" },
    "is_final": false
  }
}
```

### 3.4 tool_error（Worker → Gateway）

```json
{
  "type": "event",
  "event": "tool_error",
  "payload": {
    "request_id": "tool_call-uuid",
    "error": {
      "code": "tool_execution_failed",
      "message": "Executable is outside the allowlist",
      "retryable": false
    }
  }
}
```

## 心跳

Gateway 每 30 秒发送 WebSocket ping，Worker 自动回复 pong。

## 断线重连

Worker 断线后自动重连（默认 3 秒间隔），重新执行完整握手流程。
