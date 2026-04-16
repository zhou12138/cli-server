# 🚀 快速开始：安装 Gateway

> Gateway（landgod-gateway）是 Agent 的边车服务，部署在 Agent 同一台机器上。

> **前置条件**：确保目标 Worker 能通过网络访问本机 8080 端口。不同网络环境的配置见 [docs/00-network-prerequisites.md](../docs/00-network-prerequisites.md)。

## 一键安装

```bash
npm install -g https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod-gateway-0.1.0.tgz
```

或从本地：
```bash
npm install -g ./landgod-gateway-0.1.0.tgz
```

## 启动

```bash
landgod-gateway start --daemon
```

## 验证

```bash
landgod-gateway --version   # 确认版本号
landgod-gateway status      # 查看运行状态
curl -s http://localhost:8081/health
```

预期：
```json
{"status":"ok","connectedClients":0}
```

## 告诉你的 Agent

Gateway 启动后，Agent 只需知道：

```
API: http://localhost:8081

接口：
  GET  /health       健康检查
  GET  /clients      在线设备
  POST /tool_call    执行指令
  POST /tokens       创建 Token
```

## 端口说明

| 端口 | 协议 | 服务对象 |
|------|------|---------|
| 8081 | HTTP | Agent 调用 |
| 8080 | WebSocket | Worker 连接 |

## 开机自启（可选）

```bash
# Linux systemd
sudo tee /etc/systemd/system/landgod-gateway.service > /dev/null << 'EOF'
[Unit]
Description=LandGod-Link Gateway
After=network.target
[Service]
Type=simple
User=$USER
ExecStart=landgod-gateway start
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable landgod-gateway
```

## Python 版本（可选）

```bash
pip install ./landgod_gateway-0.1.0-py3-none-any.whl
pip install landgod-gateway[redis]  # 分布式支持
```

## 下一步

→ [安装 Worker](./QUICKSTART-WORKER.md)
