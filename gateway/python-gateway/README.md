# LandGod Gateway - Python Edition 🐍

Python 版 LandGod Gateway 服务端，与 Node.js 版协议完全兼容。

## 技术栈

- `asyncio` + `websockets` — WebSocket 服务
- `aiohttp` — HTTP API
- `cryptography` — Ed25519 签名
- `redis.asyncio` — 分布式集群模式

## 安装

```bash
cd gateway/python-gateway
pip install -e .
```

## 使用

### 单机模式（默认）

```bash
landgod-gateway-py start
landgod-gateway-py start --port 8081 --ws-port 8080
landgod-gateway-py start --daemon  # 后台运行
```

### 集群模式

```bash
landgod-gateway-py start --redis redis://localhost:6379
```

### 管理

```bash
landgod-gateway-py status
landgod-gateway-py stop
```

## API 端点

### WebSocket (:8080)

- `ws://host:8080/api/mcphub/ws` — Worker 连接端点

### HTTP (:8081)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 健康检查 |
| GET | /clients | 在线设备列表 |
| POST | /tool_call | 工具调用（支持 connection_id / clientName 路由） |
| POST | /tokens | 创建 Token |
| GET | /tokens | 列出 Token |
| DELETE | /tokens/:token | 吊销 Token |

### tool_call 示例

```bash
# 按 clientName 路由
curl -X POST http://localhost:8081/tool_call \
  -H 'Content-Type: application/json' \
  -d '{"clientName": "ZhouTest1", "tool_name": "shell_execute", "arguments": {"command": "ls"}}'

# 按 connection_id 路由
curl -X POST http://localhost:8081/tool_call \
  -H 'Content-Type: application/json' \
  -d '{"connection_id": "conn-xxx", "tool_name": "shell_execute", "arguments": {"command": "ls"}}'
```

## 分布式架构

集群模式下：
- 每个节点维护自己的 WebSocket 连接
- Worker 信息存储在 Redis（带 TTL 自动过期）
- tool_call 通过 Redis Pub/Sub 路由到持有连接的节点
- 任意 HTTP 节点可接收请求
