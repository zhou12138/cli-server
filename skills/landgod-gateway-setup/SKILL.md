---
name: landgod-gateway-setup
description: Deploy and configure LandGod Gateway (the scheduling plane). Use when setting up a new Gateway server, choosing between Python or Node.js Gateway, configuring auth tokens, setting up systemd auto-start, or troubleshooting Gateway connectivity. NOT for worker deployment (use landgod-setup) or device operations (use landgod-operate).
---

# LandGod Gateway Setup

Deploy the Gateway — the scheduling plane that connects AI agents to remote workers.

## Prerequisites

- **Python 3.10+** or **Node.js 18+** (22 recommended)
- Machine where the AI agent runs (Gateway is a sidecar to the agent)
- Outbound network access for workers to connect in

## Packages (from GitHub)

Find latest packages:
```bash
curl -sL https://api.github.com/repos/zhou12138/cli-server/contents/downloads | python3 -c "
import sys,json
for f in json.load(sys.stdin):
    if f['name'].endswith(('.tgz','.whl')):
        print(f['name'])
"
```

Install:
```bash
BASE=https://github.com/zhou12138/cli-server/raw/master/downloads

# Python Gateway (recommended)
pip install $BASE/landgod_gateway_server-<VERSION>-py3-none-any.whl

# Node.js Gateway
npm install -g $BASE/landgod-gateway-<VERSION>.tgz
```

## Interactive Setup

Ask the user these questions before deploying:

### Q1: Which language runtime?
| Option | When to choose |
|--------|---------------|
| **Python** (recommended) | Easier setup, supports Redis cluster mode |
| **Node.js** | Already have Node.js, prefer npm ecosystem |

### Q2: Generate auth token
Generate a secure random token for the user:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```
⚠️ **Save this token** — all workers must use the same token to connect.

### Q3: Single node or cluster?
| Option | When to choose |
|--------|---------------|
| **Single node** (default) | One gateway, simple setup |
| **Redis cluster** | Multiple gateway instances, high availability |

### Q4: Auto-start on boot?
Ask if they want systemd service for auto-restart.

## Install & Start

**Python Gateway:**
```bash
landgod-gateway-py start --token <TOKEN_FROM_Q2>
# Cluster: landgod-gateway-py start --token <TOKEN> --redis redis://host:6379
```

**Node.js Gateway:**
```bash
LANDGOD_AUTH_TOKEN=<TOKEN_FROM_Q2> landgod-gateway start --daemon
```

## systemd Auto-Start (if Q4 = yes)

```bash
sudo tee /etc/systemd/system/landgod-gateway.service > /dev/null << EOF
[Unit]
Description=LandGod Gateway
After=network.target
[Service]
Type=simple
User=<CURRENT_USER>
Environment=LANDGOD_AUTH_TOKEN=<TOKEN_FROM_Q2>
ExecStart=<FULL_PATH_TO_BINARY> start
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now landgod-gateway
```

## Verify

```bash
curl -s http://localhost:8081/health
# Expected: {"status":"ok","connectedClients":0}
```

## Ports

| Port | Protocol | Used By |
|------|----------|---------|
| 8080 | WebSocket | Workers connect here |
| 8081 | HTTP | Agent API calls |

## Cloudflare Tunnel (for cross-border workers)

If workers are behind GFW or NAT:
```bash
# Quick tunnel (testing, URL changes on restart)
cloudflared tunnel --url http://localhost:8080
# → Note the https://xxx.trycloudflare.com URL for worker bootstrapBaseUrl

# Named tunnel (production, stable URL)
cloudflared tunnel create landgod
cloudflared tunnel route dns landgod your-domain.com
cloudflared tunnel run --url http://localhost:8080 landgod
```

## API Quick Reference

```bash
GET  /health              # Health check
GET  /clients             # List connected workers (with labels + resources)
GET  /tools               # List registered tools per worker
POST /tool_call           # Execute command (?async=true | ?queue=true)
POST /batch_tool_call     # Parallel execution on multiple workers
GET  /tasks               # List async/queued tasks
GET  /tasks/:id           # Get task status and result
GET  /audit               # Centralized audit logs
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Workers connect then disconnect | Token mismatch | Ensure worker token matches gateway token |
| `connectedClients: 0` after restart | Gateway generates new signing keys on restart | Workers auto-reconnect (exponential backoff) |
| Port 8080 already in use | Another gateway or process | Kill old process: `lsof -i :8080` |
| Workers can't reach gateway | Firewall/NAT | Use Cloudflare Tunnel or SSH reverse tunnel |
