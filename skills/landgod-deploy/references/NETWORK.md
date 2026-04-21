# Network Architecture Reference

## Example Deployment

```
┌─ Central Node (Gateway Host) ─────────────────────────┐
│                                                        │
│  LandGod Gateway (Python or Node.js)                   │
│    HTTP :8081 / WebSocket :8080                         │
│    systemd keepalive                                    │
│                                                        │
│  Worker (headless) → ws://localhost:8080                │
│    cron keepalive                                       │
│                                                        │
│  autossh → Remote Worker (reverse tunnel)               │
│  cloudflared → Cloud Workers (Cloudflare Tunnel)        │
└────────────────────────────────────────────────────────┘

┌─ Remote Worker A (same cloud) ──────┐
│  Worker (headless) → localhost:8080  │
│  (via SSH reverse tunnel)           │
└─────────────────────────────────────┘

┌─ Remote Worker B (cross-border) ────────────┐
│  Worker (headless) → wss://xxx.example.com  │
│  (via Cloudflare Tunnel)                    │
└─────────────────────────────────────────────┘

┌─ Remote Worker C (Windows) ─────────────────┐
│  Worker (headless) → wss://xxx.example.com  │
│  schtasks keepalive                         │
└─────────────────────────────────────────────┘
```

## Connection Methods

| Scenario | bootstrapBaseUrl | How |
|----------|-----------------|-----|
| Same machine | `ws://localhost:8080` | Direct |
| Same network | `ws://GATEWAY_IP:8080` | Open port |
| Cross-network | `ws://localhost:8080` | SSH reverse tunnel |
| Cross-border/GFW | `wss://xxx.trycloudflare.com` | Cloudflare Tunnel |

## Typical Latency

| Connection Type | Latency | Reliability |
|----------------|---------|-------------|
| Direct (localhost) | <1ms | ⭐⭐⭐⭐⭐ |
| SSH tunnel (same cloud) | ~2ms | ⭐⭐⭐⭐ |
| Cloudflare Tunnel (cross-border) | 10-30ms | ⭐⭐⭐ |
