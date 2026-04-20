# Network Architecture Reference

## Current Deployment

```
┌─ ZhouTest1 (Azure US West, 20.205.20.239) ──────────┐
│                                                       │
│  Python Gateway (landgod-gateway-py)                  │
│    HTTP :8081 / WebSocket :8080                       │
│    systemd: landgod-python-gateway.service            │
│                                                       │
│  Worker (headless Node.js) → ws://localhost:8080      │
│    cron keepalive every 1 min                         │
│                                                       │
│  autossh → ZhouTest4:8080 (reverse tunnel)            │
│    systemd: landgod-tunnel-t4.service                 │
│                                                       │
│  cloudflared → Quick Tunnel (for China workers)       │
│    systemd: cloudflared-tunnel.service                │
│                                                       │
│  OpenClaw Gateway (4 AI agents)                       │
│    悟空🐒 / 夜游神👁️ / 太白金星🌟 / 二郎神👁‍🗨              │
└───────────────────────────────────────────────────────┘

┌─ ZhouTest4 (Azure, 20.2.89.92) ─┐
│  Worker (headless) → localhost:8080 │
│  (via SSH reverse tunnel)           │
│  cron keepalive, fail2ban           │
└─────────────────────────────────────┘

┌─ Alibaba Cloud Linux (Beijing, 39.105.220.11) ─┐
│  Worker (headless) → wss://xxx.trycloudflare.com  │
│  (via Cloudflare Tunnel, GFW bypass)               │
│  cron keepalive                                    │
└────────────────────────────────────────────────────┘

┌─ Alibaba Cloud Windows (China, 47.114.126.243) ─┐
│  Worker (headless) → wss://xxx.trycloudflare.com   │
│  schtasks keepalive                                 │
└─────────────────────────────────────────────────────┘
```

## Latency Benchmarks (100x curl www.baidu.com)

| Node | Avg Latency | Success Rate |
|------|-------------|-------------|
| ZhouTest1 (Azure US) | 20ms | 100% |
| ZhouTest4 (Azure US) | 22ms | 100% |
| Alibaba Cloud (Beijing) | 10ms | 100% |
