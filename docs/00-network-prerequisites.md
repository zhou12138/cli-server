# 前置条件：网络环境准备

> ⚠️ 本文档不是 LandGod 的核心功能文档，而是部署前的网络环境准备指南。
> LandGod 只负责 Gateway ↔ Worker 的 WebSocket 通信，不负责网络通道的建立。
> 
> **核心前提**：确保 Worker 能访问 Gateway 的 8080 端口（`ws://GATEWAY:8080`）。

```
┌──────────────────────────────────────────────────┐
│                Gateway 位置                       │
│           公网        内网A        内网B          │
│  Worker ┌─────────┬───────────┬───────────┐     │
│  位置   │         │           │           │     │
│  同机器 │ ① 直连  │  ① 直连   │  ① 直连   │     │
│  同局域 │ ② 直连  │  ③ 局域网 │  ⑤ 穿透   │     │
│  公网   │ ② 直连  │  ⑤ 穿透   │  ⑤ 穿透   │     │
│  内网   │ ② 直连  │  ③/④      │  ⑤ 穿透   │     │
│         └─────────┴───────────┴───────────┘     │
└──────────────────────────────────────────────────┘
```

---

## ① 同一台机器

**最简单，零配置。**

```bash
landgod config set bootstrapBaseUrl "ws://localhost:8080"
```

```
┌──────────────────┐
│ Gateway :8080    │
│ Worker           │ → ws://localhost:8080
└──────────────────┘
```

---

## ② Worker 可访问 Gateway 公网 IP

```bash
landgod config set bootstrapBaseUrl "ws://20.205.20.239:8080"
```

```
Worker ──── 公网 ────► Gateway (20.205.20.239:8080)
```

⚠️ 需在云服务商安全组/防火墙开放 8080 端口。

---

## ③ 同一局域网 / 同一 VPC

```bash
landgod config set bootstrapBaseUrl "ws://192.168.1.50:8080"
```

```
局域网 192.168.1.0/24
┌──────────────┐        ┌──────────────┐
│ Gateway      │◄───────│ Worker       │
│ 192.168.1.50 │        │ 192.168.1.100│
└──────────────┘        └──────────────┘
```

包括：同一 Azure/AWS VPC、同一办公网络、同一家庭 WiFi。

---

## ④ 跨网络 — SSH 隧道（一端有公网）

### 正向隧道（Worker → Gateway）

Worker 主动连到有公网 IP 的 Gateway：

```bash
# 在 Worker 机器上执行
ssh -L 8080:localhost:8080 user@GATEWAY_PUBLIC_IP

# Worker 配置
landgod config set bootstrapBaseUrl "ws://localhost:8080"
```

### 反向隧道（Gateway → Worker）

Gateway 把端口推送到 Worker：

```bash
# 在 Gateway 机器上执行
ssh -f -N -R 8080:localhost:8080 user@WORKER_IP

# Worker 配置
landgod config set bootstrapBaseUrl "ws://localhost:8080"
```

**隧道保活**：
```bash
ssh -f -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 8080:localhost:8080 user@WORKER_IP
```

**密钥认证**（推荐，不依赖密码）：
```bash
ssh -i ~/.ssh/landgod_deploy -f -N -R 8080:localhost:8080 user@WORKER_IP
```

---

## ⑤ 双方都在内网 — NAT 穿透

```
内网 A                              内网 B
┌──────────┐   ❌ 互不可达   ┌──────────┐
│ Gateway  │                  │ Worker   │
│ NAT 后面 │                  │ NAT 后面 │
└──────────┘                  └──────────┘
```

### 方案 A：Cloudflare Tunnel（推荐）

Gateway 端（一次性）：
```bash
curl -fsSL https://pkg.cloudflare.com/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared tunnel --url ws://localhost:8080
# 输出: https://xxx-yyy-zzz.trycloudflare.com
```

Worker 端：
```bash
landgod config set bootstrapBaseUrl "wss://xxx-yyy-zzz.trycloudflare.com"
```

✅ 免费、自动 TLS、零端口开放。

### 方案 B：Tailscale

两端安装：
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Worker 配置：
```bash
landgod config set bootstrapBaseUrl "ws://100.64.x.x:8080"
```

✅ WireGuard 加密、NAT 穿透。需两端安装。

### 方案 C：ngrok

Gateway 端：
```bash
ngrok http 8080
# 输出: https://xxxx.ngrok.io
```

Worker 端：
```bash
landgod config set bootstrapBaseUrl "wss://xxxx.ngrok.io"
```

⚠️ 免费版有限制。

### 方案 D：FRP 自建穿透

需要一台公网 VPS 作为中继。适合长期稳定使用。

---

## 跨境网络注意事项

| 线路 | 稳定性 | 建议 |
|------|--------|------|
| 同区域（Azure↔Azure） | ⭐⭐⭐⭐⭐ | SSH 隧道即可 |
| 跨区域同云（Azure US↔Azure CN） | ⭐⭐⭐ | Cloudflare Tunnel |
| 跨云跨境（Azure↔阿里云） | ⭐⭐ | Cloudflare Tunnel 或 Tailscale |
| 公网直连（中国→海外） | ⭐ | 不推荐，丢包严重 |

**经验**：Azure（美国）↔ 阿里云（中国）SSH 反向隧道频繁断连，必须用 Cloudflare Tunnel 或 Tailscale。

---

## 方案选择决策树

```
Q: Worker 和 Gateway 在同一台机器？
  → Yes: ① ws://localhost:8080
  → No ↓

Q: 在同一局域网/VPC？
  → Yes: ③ ws://内网IP:8080
  → No ↓

Q: Gateway 有公网 IP？
  → Yes: Worker 能直连？
    → Yes: ② ws://公网IP:8080
    → No: ④ SSH 反向隧道
  → No ↓

Q: 都在内网？
  → 临时使用: ⑤A Cloudflare Tunnel
  → 长期使用: ⑤B Tailscale
```
