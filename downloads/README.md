# 📦 Downloads

LandGod 安装包下载目录。

## 产物列表

| 包名 | 文件 | 用途 | 安装方式 |
|------|------|------|---------|
| **LandGod Worker** | `cli-server-0.1.0.tgz` | 远程设备上运行的 Worker 节点 | `npm install -g` |
| **LandGod-Link Gateway (Node.js)** | `landgod-link-0.1.0.tgz` | Agent 边车网关（Node.js 版） | `npm install -g` |
| **LandGod-Link Gateway (Python wheel)** | `landgod_link-0.1.0-py3-none-any.whl` | Agent 边车网关（Python 版，推荐） | `pip install` |
| **LandGod-Link Gateway (Python sdist)** | `landgod_link-0.1.0.tar.gz` | Agent 边车网关（Python 源码包） | `pip install` |

---

## 快速安装

### 从 GitHub 直接安装

**Node.js Agent — 安装 Gateway：**
```bash
npm install -g https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod-link-0.1.0.tgz
landgod-link start --daemon
```

**Python Agent — 安装 Gateway：**
```bash
pip install https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/landgod_link-0.1.0-py3-none-any.whl
```

**远程设备 — 安装 Worker：**
```bash
npm install -g https://github.com/zhou12138/cli-server/raw/fix/cors-handlers/downloads/cli-server-0.1.0.tgz
landgod onboard
```

### 从本地文件安装

```bash
# Node.js Gateway
npm install -g ./downloads/landgod-link-0.1.0.tgz

# Python Gateway
pip install ./downloads/landgod_link-0.1.0-py3-none-any.whl

# Worker
npm install -g ./downloads/cli-server-0.1.0.tgz
```

---

## 架构说明

```
AI Agent (任意智能体)
  │
  │ HTTP POST http://localhost:8081/tool_call
  │
  ▼
LandGod-Link Gateway (边车)    ← landgod-link-0.1.0.tgz / .whl
  │
  │ WebSocket + Ed25519 签名
  │
  ├──► LandGod Worker A         ← cli-server-0.1.0.tgz
  ├──► LandGod Worker B
  └──► LandGod Worker C
```

---

## API 接口

Gateway 启动后，Agent 可以调用以下接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `GET` | `/clients` | 列出在线 Worker |
| `POST` | `/tool_call` | 向 Worker 发送指令 |
| `POST` | `/tokens` | 创建设备 Token |
| `GET` | `/tokens` | 列出所有 Token |
| `DELETE` | `/tokens/:token` | 吊销 Token |

### tool_call 示例

```json
POST /tool_call
{
  "tool_name": "shell_execute",
  "arguments": { "command": "hostname" },
  "connection_id": "conn-xxx (可选，不填则自动选择)",
  "timeout": 10000
}
```

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0 | 2026-04-15 | 首个版本：Worker + Gateway + Token 管理 |
