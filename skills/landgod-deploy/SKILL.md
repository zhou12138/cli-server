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

The base URL is `https://github.com/zhou12138/cli-server/raw/master/downloads/`. Package filenames include version numbers that change with each release. To find the latest version:

```bash
# List available packages (get latest filenames)
curl -sL https://api.github.com/repos/zhou12138/cli-server/contents/downloads | python3 -c "
import sys,json
for f in json.load(sys.stdin):
    if f['name'].endswith(('.tgz','.whl')):
        print(f['name'])
"
```

Then install with the discovered filenames:

```bash
BASE=https://github.com/zhou12138/cli-server/raw/master/downloads

# Node.js Gateway (find latest: landgod-gateway-*.tgz)
npm install -g $BASE/landgod-gateway-<VERSION>.tgz

# Node.js Worker (find latest: landgod-*.tgz, NOT landgod-gateway)
npm install -g $BASE/landgod-<VERSION>.tgz

# Python Gateway Server (find latest: landgod_gateway_server-*-py3-none-any.whl)
pip install $BASE/landgod_gateway_server-<VERSION>-py3-none-any.whl

# Python SDK (find latest: landgod_gateway-*-py3-none-any.whl, NOT _server)
pip install $BASE/landgod_gateway-<VERSION>-py3-none-any.whl
```

⚠️ If GitHub is unreachable (China networks), configure a proxy or ask the user to download and transfer the package manually. Do NOT use SCP between machines.

## 1. Gateway Setup

Before installing, ask the user these questions:

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

### Install & Start

**Python Gateway:**
```bash
pip install <whl from packages section>
landgod-gateway-py start --token <TOKEN_FROM_Q2>
# Cluster: landgod-gateway-py start --token <TOKEN> --redis redis://host:6379
```

**Node.js Gateway:**
```bash
npm install -g <tgz from packages section>
LANDGOD_AUTH_TOKEN=<TOKEN_FROM_Q2> landgod-gateway start --daemon
```

### systemd keepalive (if Q4 = yes)

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

### Verify
```bash
curl -s http://localhost:8081/health
# Expected: {"status":"ok","connectedClients":0}
```

Ports: **8080** (WebSocket, workers connect here), **8081** (HTTP API, agents call here).

## 2. Worker Deployment

Before deploying a worker, ask the user these questions:

### Q1: How will you access the target machine?
| Option | Method | Prerequisites |
|--------|--------|--------------|
| **SSH access** | You SSH in and run commands | SSH credentials |
| **Direct access** | You're on the target machine | Terminal access |
| **No access** | User runs commands themselves | Give them instructions |

### Q2: What OS is the target machine?
| OS | Package manager | Notes |
|----|----------------|-------|
| **Linux** | npm (Node.js) | Most common, headless recommended |
| **Windows** | npm (Node.js) | Must cd to package dir for headless |
| **macOS** | npm (Node.js) | Same as Linux |

### Q3: Network connectivity — How can the worker reach the Gateway?
| Scenario | `bootstrapBaseUrl` | Setup needed |
|----------|--------------------|-------------|
| **Same machine** | `ws://localhost:8080` | None |
| **Same network/VPN** | `ws://<GATEWAY_IP>:8080` | Open port 8080 on gateway |
| **Cross-network** | `ws://localhost:8080` | SSH reverse tunnel first |
| **Cross-border/GFW** | `wss://<TUNNEL>.trycloudflare.com` | Cloudflare Tunnel on gateway |

If cross-network: set up SSH reverse tunnel first:
```bash
ssh -R 8080:localhost:8080 user@target-machine
```

If cross-border: set up Cloudflare Tunnel on gateway:
```bash
cloudflared tunnel --url http://localhost:8080
# Note the generated URL for bootstrapBaseUrl
```

### Q4: What security level?
| Profile | Use case | Risk |
|---------|----------|------|
| **command-only** | Read-only monitoring (echo, ls, cat, ps, df) | Low |
| **interactive-trusted** | Development (+ git, node, npm, curl, python) | Medium |
| **full-local-admin** | Full management (+ rm, chmod, systemctl, everything) | High |

⚠️ `full-local-admin` gives complete control. Only use when you fully trust the remote agent.

### Q5: Run mode
| Mode | When to choose |
|------|---------------|
| **Headless** (recommended) | Servers, no GUI needed, lighter |
| **GUI (Electron)** | Desktop, want visual dashboard, need manual approval |

### Q6: Worker labels (optional)
Ask if they want to tag this worker with capabilities:
```bash
# Examples:
landgod config set labels '{"role":"ml","gpu":true}'
landgod config set labels '{"region":"cn","role":"monitor"}'
landgod config set labels '{"platform":"windows","role":"build"}'
```

### Step 1: Install
```bash
npm install -g <tgz from packages section>
```

For GUI mode, also install Electron dependencies:
```bash
cd $(node -e "console.log(require.resolve('landgod/package.json').replace('/package.json',''))")
npm install
# Linux GUI also needs: sudo apt-get install -y libgtk-3-0 libnss3 libasound2t64 libcups2 xvfb
```

### Step 2: Configure

Apply answers from the questions above:

```bash
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "<ANSWER_FROM_Q3>"
landgod config set token "<GATEWAY_TOKEN>"
landgod config set toolCallApprovalMode auto        # or manual for Q5=GUI
landgod config set builtInTools.permissionProfile <ANSWER_FROM_Q4>
```

If Q6 was answered:
```bash
landgod config set labels '<JSON_FROM_Q6>'
```

### Step 3: Start

```bash
# Headless (Q5 = headless)
landgod daemon start --headless

# GUI (Q5 = GUI)
landgod daemon start

# Windows headless — must cd to package dir first
cd C:\...\node_modules\landgod
node .vite\build\headless-entry.js
```

### Step 4: Verify

From the Gateway machine:
```bash
curl -s http://localhost:8081/clients
# The new worker should appear in the list
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

# List registered tools per worker
curl http://localhost:8081/tools

# Execute command on worker
curl -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{"clientName":"<NAME>","tool_name":"shell_execute","arguments":{"command":"hostname"}}'

# Parallel batch execution on multiple workers
curl -X POST http://localhost:8081/batch_tool_call \
  -H "Content-Type: application/json" \
  -d '{"calls":[
    {"clientName":"Worker1","tool_name":"shell_execute","arguments":{"command":"hostname"}},
    {"clientName":"Worker2","tool_name":"shell_execute","arguments":{"command":"hostname"}}
  ]}'

# Centralized audit logs (all workers or specific)
curl http://localhost:8081/audit
curl "http://localhost:8081/audit?clientName=<NAME>&limit=20"
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

## 7. MCP Server Tool Name Matching (Critical)

The `tools` array in `managed-client.mcp-servers.json` is a **strict whitelist**. Only tools whose names exactly match will be published to the gateway. Mismatched names are silently filtered — no error, tools just don't appear.

⚠️ **Always verify actual tool names before configuring.** Run the MCP server locally to get real names:
```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | timeout 5 npx @playwright/mcp 2>/dev/null
```

### @playwright/mcp actual tool names (as of 2026)
The current version uses `browser_*` naming. **NOT** the old `init-browser`/`get-full-dom` style.

Correct names: `browser_close`, `browser_resize`, `browser_console_messages`, `browser_handle_dialog`, `browser_evaluate`, `browser_file_upload`, `browser_fill_form`, `browser_press_key`, `browser_type`, `browser_navigate`, `browser_navigate_back`, `browser_network_requests`, `browser_run_code`, `browser_take_screenshot`, `browser_snapshot`, `browser_click`, `browser_drag`, `browser_hover`, `browser_select_option`, `browser_tabs`, `browser_wait_for`

### Wildcard blocked
`"tools": ["*"]` is explicitly blocked by `shouldPublishExternalServerRemotely`. Empty `tools: []` is also blocked. You must list every tool by exact name.

## 8. Worker Reconnect Behavior

Workers use **exponential backoff** for reconnection:
- Start at 3 seconds, double each failure (3s → 6s → 12s → 24s → 48s → 60s cap)
- Random jitter (0-1s) added to prevent thundering herd
- Resets to 3s on successful connection

On reconnect, external MCP server tools can be temporarily lost:
- **First connection**: sends all tools (e.g. 28 = 7 built-in + 21 playwright)
- **Reconnects**: may send only 7 built-in tools initially
- **After stabilization**: external MCP tools re-register

This is visible in `audit.jsonl` — look for `update_tools` entries. If persistent, restart the worker.

## 9. Common Pitfalls

### Token mismatch
Gateway and workers must use the **exact same token**. Symptom: `Connection closed while waiting for session_opened`. Fix: verify token on both sides before debugging anything else.

### Quick Tunnel URL changes on restart
`cloudflared tunnel --url` generates a random URL each time. After restart:
1. Get new URL from log
2. Update all tunnel-connected workers: `landgod config set bootstrapBaseUrl wss://NEW_URL`
3. Restart workers

For stable URL, use a domain with Cloudflare named tunnel.

### Only run one gateway
Never run Python and Node.js gateways simultaneously on the same machine — port conflicts and token confusion. Pick one, uninstall the other.

### Windows headless requires correct working directory
`landgod daemon start --headless` on Windows may fail because the config file is read from `process.cwd()`. Always `cd` to the landgod package directory first:
```cmd
cd /d C:\...\node_modules\landgod
node .vite\build\headless-entry.js
```
Use a `.bat` file with `schtasks` for persistence.

### Worker keepalive is per-machine
Each machine running a worker needs its own keepalive:
- **Linux:** cron job checking `pgrep -f headless-entry` every minute
- **Windows:** `schtasks /SC ONSTART` with bat file

### China networks can't reach GitHub
`npm install` from GitHub URL will timeout. Ask the user to configure a proxy on the target machine or download the package manually. **Do not SCP packages between machines.**

### `remote_configure_mcp_server` creates servers with trustLevel=experimental
Servers created via the remote API default to `trustLevel=experimental`, which blocks remote publication. You must manually edit `managed-client.mcp-servers.json` on the worker to set `"trustLevel": "trusted"`, then restart the worker.

### After `make clean && make`, verify packages
Always check that `downloads/` contains all expected packages. The Makefile may not build the Python Gateway Server — build it separately with `python3 -m build` in `gateway/python-gateway/`.

### WebSocket path rules (bootstrapBaseUrl)

The `bootstrapBaseUrl` determines the WebSocket URL the worker connects to:

| bootstrapBaseUrl | Generated WS URL | Notes |
|---|---|---|
| `ws://localhost:8080` | `ws://localhost:8080/` | No path appended |
| `wss://tunnel.trycloudflare.com` | `wss://tunnel.trycloudflare.com/` | No path appended |
| `https://example.com/api` | `wss://example.com/api/mcphub/ws` | Auto-appends `/mcphub/ws` |
| `https://example.com/api/mcphub/ws` | `wss://example.com/api/mcphub/ws` | Already has it, no change |

**Rule:** `/api/mcphub/ws` is only appended when the path starts with `/api`.

**LandGod Gateway** accepts any path (no path checking), so this only matters when connecting to external WebSocket servers that require a specific path.

### "Unexpected server response: 200" error

This means the WebSocket upgrade request hit an HTTP endpoint instead of a WS endpoint. Common causes:
- **Wrong port**: connecting to HTTP port (8081) instead of WS port (8080)
- **Tunnel misconfigured**: Cloudflare Tunnel pointing to wrong backend port
- **Path mismatch**: remote server expects `/api/mcphub/ws` but client sends `/`
- **Proxy interference**: reverse proxy returning HTML instead of upgrading WebSocket

Fix: verify `bootstrapBaseUrl` points to the correct WS port and path.

### npm start works but tgz package fails (403 or connection error)

The WebSocket logic is identical in both, but the runtime environment differs:

| | `npm start` (dev) | tgz package (prod) |
|---|---|---|
| Entry | vite dev server, hot reload | Pre-compiled `.vite/build/index.js` |
| ws module | Loaded from `node_modules/` | Bundled by rollup into index.js |
| Electron | Dev mode | Production mode with `--no-sandbox` |
| Headers | Standard Node.js `ws` headers | May have Electron-injected Origin |

**If 403**: Electron packaged mode may inject a different `Origin` header. The fix (v0.1.2+) explicitly sets Origin to match the WS URL.

**If 200**: The connection is hitting an HTTP endpoint, not a WebSocket endpoint. Check port and path.
