---
name: landgod-deploy
description: "Install and deploy LandGod gateway + workers for remote device management. Use when: setting up a new gateway, deploying workers to new machines (Linux/Windows), configuring network tunnels for cross-border connectivity, or troubleshooting connection issues. Covers Python and Node.js gateway, headless worker mode, SSH tunnels, Cloudflare Tunnel, and systemd/cron keepalive."
---

# LandGod Deploy Skill

Deploy LandGod gateway and workers for AI-driven remote device fleet management.

## Prerequisites

Before deploying a worker to a new machine, you need:

1. **SSH access to the target machine** — You must be able to SSH in to install packages and configure the worker. Ask the user to provide SSH credentials (IP, username, password/key). ⚠️ **Never store credentials in chat, logs, or memory files.** Use them only for the current session and discard immediately after.
2. **Node.js 22+** on the target — If not installed, install it first (`apt install nodejs` / `yum install nodejs` / download from nodejs.org for Windows).
3. **Network path from worker → gateway** — The worker needs to reach the gateway's WebSocket port (8080). This can be:
   - **Direct**: worker can reach `ws://GATEWAY_IP:8080` (same LAN or open port)
   - **SSH reverse tunnel**: gateway SSHs to worker, maps port 8080 back
   - **Cloudflare Tunnel**: gateway exposes 8080 via `wss://xxx.trycloudflare.com`
   - ⚠️ The worker initiates the WebSocket connection **outbound** — the gateway does NOT need to reach the worker. Only the worker needs to reach the gateway.
4. **Token** — A valid gateway token for the worker to authenticate. Use the default `YOUR_SECRET_TOKEN` or create one via `POST /tokens`.

### Network direction

```
Worker ──(outbound WebSocket)──→ Gateway:8080
Agent  ──(outbound HTTP)──────→ Gateway:8081

Gateway does NOT need to reach workers.
Workers do NOT need to reach each other.
SSH is only needed during initial deployment (install + config).
```

## Packages (all from GitHub)

⚠️ **Always install from GitHub URL. Never SCP/copy packages between machines — this is forbidden.**

If GitHub is unreachable (e.g. China networks), configure a proxy on the target machine first, or ask the user to manually download and transfer the package.

```bash
# Node.js Gateway
npm install -g https://github.com/zhou12138/cli-server/raw/master/downloads/landgod-gateway-0.1.0.tgz

# Node.js Worker
npm install -g https://github.com/zhou12138/cli-server/raw/master/downloads/landgod-0.1.0.tgz

# Python Gateway (single-node + Redis cluster)
pip install https://github.com/zhou12138/cli-server/raw/master/downloads/landgod_gateway_server-0.1.0-py3-none-any.whl

# Python SDK (for calling gateway from Python)
pip install https://github.com/zhou12138/cli-server/raw/master/downloads/landgod_gateway-0.1.0-py3-none-any.whl
```

⚠️ If GitHub is unreachable (China networks), configure a proxy or ask the user to download and transfer the package manually. Do NOT use SCP between machines.

## 1. Gateway Setup

### Python Gateway (recommended)

```bash
pip install <whl from above>

# Start with custom token (recommended — avoid using default hardcoded token)
landgod-gateway-py start --token YOUR_SECRET_TOKEN

# Or via environment variable
LANDGOD_AUTH_TOKEN=YOUR_SECRET_TOKEN landgod-gateway-py start

# Cluster mode with Redis
landgod-gateway-py start --token YOUR_SECRET_TOKEN --redis redis://host:6379
```

⚠️ **Always set a custom token.** The default `YOUR_SECRET_TOKEN` is public and insecure. Generate a random token: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`

### Node.js Gateway

```bash
npm install -g <tgz from above>

# Start with custom token
landgod-gateway start --daemon --token YOUR_SECRET_TOKEN

# Or via environment variable
LANDGOD_AUTH_TOKEN=YOUR_SECRET_TOKEN landgod-gateway start --daemon
```

### systemd keepalive

```ini
# /etc/systemd/system/landgod-python-gateway.service
[Unit]
Description=LandGod Python Gateway
After=network.target
[Service]
Type=simple
User=<USER>
ExecStart=<PATH_TO>/landgod-gateway-py start
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```

Ports: **8080** (WebSocket, workers connect here), **8081** (HTTP API, agents call here).

## 2. Worker Deployment

### Step 1: Install

```bash
npm install -g <tgz from above>
```

### Step 2: Configure

```bash
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "<GATEWAY_WS_URL>"  # see network section
landgod config set token "<TOKEN>"
landgod config set toolCallApprovalMode auto
landgod config set builtInTools.permissionProfile full-local-admin
```

### Step 3: Start

```bash
# Linux server (recommended)
landgod daemon start --headless

# Windows server
# Must cd to landgod package dir first!
cd <npm_global>/node_modules/landgod
node .vite\build\headless-entry.js

# Desktop with GUI
landgod daemon start
```

### Step 4: Verify

```bash
landgod health          # check daemon status
curl localhost:8081/clients  # check from gateway side
```

## 3. Network Connectivity

Choose based on network environment:

### Same machine
```
bootstrapBaseUrl = ws://localhost:8080
```

### Same network / VPN
```
bootstrapBaseUrl = ws://<GATEWAY_PRIVATE_IP>:8080
```
Requires gateway port 8080 accessible.

### Cross-network via SSH reverse tunnel
On gateway machine:
```bash
autossh -M 0 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -i <SSH_KEY> -R 8080:localhost:8080 <WORKER_USER>@<WORKER_IP>
```
Worker config: `bootstrapBaseUrl = ws://localhost:8080`

systemd for tunnel:
```ini
[Service]
ExecStart=/usr/bin/autossh -M 0 -N -R 8080:localhost:8080 user@worker
Restart=always
RestartSec=15
```

### Cross-border / GFW (Cloudflare Tunnel)
On gateway machine:
```bash
cloudflared tunnel --url http://localhost:8080
# Note the trycloudflare.com URL
```
Worker config: `bootstrapBaseUrl = wss://<URL>.trycloudflare.com`

⚠️ Quick Tunnel URL changes on restart. For stable URL, bind a domain to Cloudflare.

### Decision tree
```
Can worker reach gateway:8080 directly?
├─ Yes → ws://GATEWAY_IP:8080
├─ Same cloud but no open port → SSH reverse tunnel
└─ Cross-border/GFW → Cloudflare Tunnel (wss://)
```

## 4. Worker Keepalive

### Linux cron (every minute)
```bash
#!/bin/bash
export PATH=<NODE_BIN>:$PATH
if ! pgrep -f "headless-entry" > /dev/null 2>&1; then
    landgod daemon start --headless >> /tmp/landgod-keepalive.log 2>&1
fi
```
`crontab -e` → `* * * * * /path/to/keepalive.sh`

### Windows scheduled task
```cmd
schtasks /Create /TN LandGodWorker /TR "C:\path\to\landgod-start.bat" /SC ONSTART /RU Administrator /F
```
Where `landgod-start.bat`:
```cmd
cd /d C:\Users\...\node_modules\landgod
node .vite\build\headless-entry.js
```

## 5. Gateway API Quick Reference

```bash
# Health check
curl http://localhost:8081/health

# List online workers
curl http://localhost:8081/clients

# Execute command on worker
curl -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{"clientName":"<NAME>","tool_name":"shell_execute","arguments":{"command":"hostname"}}'

# Create token
curl -X POST http://localhost:8081/tokens \
  -d '{"device_name":"new-device"}'
```

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Worker shows online but tool_call timeout | `toolCallApprovalMode` is `manual` | Set to `auto` |
| Worker shows online but `{success:true}` only | `permissionProfile` is `command-only` | Set to `full-local-admin` |
| `clientName` routes to wrong worker | Gateway bug (old version) | Update gateway, use `connection_id` |
| Windows headless daemon exits immediately | Wrong cwd | Must `cd` to landgod package dir first |
| China can't install from GitHub | Network timeout | SCP tgz/whl from reachable machine |
| Quick Tunnel URL changed | Tunnel restarted | Update worker `bootstrapBaseUrl` + restart |
| `allowedExecutableNames: []` error | Config serialization bug | Rebuild with latest source |

## 7. Lessons Learned (Operational Pitfalls)

### Token must match everywhere
Gateway and all workers must use the **same token**. Mismatched tokens cause `Connection closed while waiting for session_opened` — looks like a protocol bug but is just auth failure. Before debugging WebSocket issues, always verify:
```bash
# On gateway: check what token it's using
cat /proc/$(pgrep -f landgod-gateway)/environ | tr '\0' '\n' | grep TOKEN

# On worker: check its token
landgod config show | grep token
```

### Quick Tunnel URL changes on every restart
Cloudflare Quick Tunnel (`cloudflared tunnel --url`) generates a **random URL** each time. When the tunnel restarts, ALL workers using it must be updated. This is the #1 cause of "worker was online but now disconnected."

**Mitigation:** Use a domain with named tunnel. Until then, after every tunnel restart:
1. Note the new `trycloudflare.com` URL
2. Update every worker: `landgod config set bootstrapBaseUrl wss://NEW_URL`
3. Restart worker: `landgod daemon stop && landgod daemon start --headless`

### Don't mix Python and Node.js gateways
Only ONE gateway should run at a time. If both Python and Node.js gateways exist on the machine, confusion arises (wrong code version, different token stores). Pick one and uninstall the other:
```bash
# Uninstall Node.js gateway
npm uninstall -g landgod-gateway

# Or uninstall Python gateway
pip uninstall landgod-gateway-server
```

### Gateway code lives in TWO directories
Node.js gateway code exists in both `gateway/server/` and `gateway/sdk-node/`. The Makefile builds from `sdk-node/`. **Always sync changes to both:**
```bash
cp gateway/server/index.js gateway/sdk-node/server/index.js
```

### Worker headless mode on Windows needs correct cwd
Windows headless daemon must run from the landgod package directory:
```cmd
cd /d C:\...\node_modules\landgod
node .vite\build\headless-entry.js
```
Using `landgod daemon start --headless` may fail because the child process inherits wrong cwd. Use `schtasks` with a `.bat` file that `cd`s first.

### Worker keepalive is per-machine
Each worker machine needs its own keepalive (cron on Linux, schtasks on Windows). The gateway keepalive doesn't help workers — they're separate processes on separate machines.

### `git add -A` is dangerous
Never use `git add -A` in the cli-server repo — it will commit `node_modules/`, `out/`, `.vite/`, and other build artifacts. Always use `git add <specific files>` or `git add -f downloads/`.
