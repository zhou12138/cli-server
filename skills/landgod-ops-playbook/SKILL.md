---
name: landgod-ops-playbook
description: Hard-won operational lessons for managing LandGod clusters. Use when troubleshooting worker disconnections, Gateway restarts, token mismatches, config issues, cross-border tunnels, Windows headless quirks, or any LandGod operational problem. This is a collection of real-world pitfalls and fixes from production experience. NOT for initial deployment (use landgod-gateway-setup / landgod-setup).
---

# LandGod Ops Playbook — Lessons From Production

Real-world operational lessons. Every entry here cost us debugging time.

## 🔑 Token Management

### Token mismatch is the #1 cause of "all workers offline"

**Symptom:** Gateway shows `connectedClients: 0`, workers are running but can't connect.

**Root cause:** Gateway was restarted with a different token than workers use.

**How it happens:**
1. Agent A starts Gateway with token X
2. Agent B restarts Gateway with token Y (or default `hardcoded-token-1234`)
3. All workers still have token X → connection rejected

**Fix:** Check Gateway's actual token, then update all workers:
```bash
# Find Gateway's token
cat /proc/$(pgrep -f "landgod-gateway/server" | head -1)/environ | tr '\0' '\n' | grep LANDGOD_AUTH_TOKEN

# Update worker config
landgod config set token "<CORRECT_TOKEN>"
```

**Prevention:** Store the token in a shared location (e.g. environment variable file, secrets manager). Never use `hardcoded-token-1234` in production.

### Gateway log shows "rejected" vs "connected"

```bash
# Quick check
grep -E "rejected|connected" ~/.landgod-gateway/gateway.log | tail -10
```
- `Client connection rejected due to invalid token.` → Token mismatch
- `Client connected with valid token!` → Working

## 🔄 Gateway Restart Behavior

### Gateway restart = all workers disconnect

Gateway generates new Ed25519 signing keys on every restart. All existing sessions become invalid. Workers must reconnect and re-register.

**What happens:**
1. Gateway restarts → new keys generated
2. Workers detect disconnect → exponential backoff retry (3s→6s→12s→...→60s)
3. Workers reconnect → re-register → re-publish tools
4. Normal operation resumes

**How long until recovery:** Usually 3-60 seconds depending on backoff state.

**If workers don't come back after 2 minutes:**
1. Check token matches
2. Check network/tunnel is still up
3. Restart workers manually

### Only run ONE Gateway

Running multiple Gateway instances on the same port causes silent failures. Workers connect to whichever instance answers first, tool_call may route to the wrong instance.

```bash
# Kill all gateway processes before starting
pkill -f "landgod-gateway" && sleep 2
landgod-gateway start --daemon --token <TOKEN>
```

## 📝 Config Pitfalls

### Always use `landgod config set`, never edit JSON manually

```bash
# ✅ Correct — creates proper nested JSON
landgod config set builtInTools.permissionProfile full-local-admin
# Result: {"builtInTools": {"permissionProfile": "full-local-admin"}}

# ❌ Wrong — manual edit creates flat key, silently ignored
echo '{"builtInTools.permissionProfile": "full-local-admin"}' > config.json
# Result: profile stays as command-only, no error message
```

### `permissionProfile` determines stdout visibility

| Profile | `shell_execute` returns | `file_read` works |
|---------|------------------------|-------------------|
| `command-only` | `{"success": true}` only, **no stdout** | ❌ |
| `interactive-trusted` | `{"success": true}` only, **no stdout** | ❌ |
| `full-local-admin` | Full stdout + stderr + exit_code | ✅ |

**If you see `{"success":true}` but no output** → profile is not `full-local-admin`.

### `toolCallApprovalMode` must be `auto` for headless

If set to `manual` (default), every tool_call is auto-rejected in headless mode because there's no UI to click "approve". Result: `user_rejected` error.

```bash
landgod config set toolCallApprovalMode auto
```

### Config survives process restart but NOT `npm install -g`

`npm install -g` **overwrites the entire package directory**, including `managed-client.config.json`. Always re-configure after reinstalling.

## 🌐 Network & Tunnels

### Quick Tunnel URL changes on every restart

`cloudflared tunnel --url http://localhost:8080` generates a random URL like `https://xyz.trycloudflare.com`. If cloudflared restarts, the URL changes. All workers using the old URL will fail to connect.

**Fix:** Update all workers' `bootstrapBaseUrl` after tunnel restart.

**Prevention:** Use a named Cloudflare Tunnel with a fixed domain.

### SSH reverse tunnels are fragile

SSH tunnels drop on:
- Network hiccup
- SSH keepalive timeout
- Server-side `ClientAliveInterval` expiry
- Firewall session timeout

**Strongly recommend Cloudflare Tunnel instead.** If you must use SSH:
```bash
# Use autossh for auto-reconnect
autossh -M 0 -fNR 8080:localhost:8080 user@target -o ServerAliveInterval=30
```

### Cross-border (GFW) connectivity

| Works | Blocked |
|-------|---------|
| Cloudflare Tunnel (WSS) | Direct SSH (sometimes) |
| github.com (usually) | google.com |
| npmjs.com (sometimes) | docker hub (sometimes) |

For China workers:
1. Use Cloudflare Tunnel for Gateway connection
2. Configure npm proxy for package installation
3. Have a fallback: download packages manually if npm timeout

## 🪟 Windows-Specific Issues

### Windows headless MUST cd to package directory

```cmd
REM ❌ Wrong — cwd mismatch, config not found
node C:\path\to\landgod\.vite\build\headless-entry.js

REM ✅ Correct — cd first
cd /d C:\Users\Administrator\.npm-global\lib\node_modules\landgod
node .vite\build\headless-entry.js
```

### Windows Worker needs these commands in allowlist

Default `full-local-admin` profile includes Linux commands. For Windows add:
```
tasklist, systeminfo, ipconfig, netstat, whoami, dir, type, findstr, wmic
```

Or configure via:
```bash
landgod config set builtInTools.shellExecute.allowedExecutableNames '["echo","hostname","whoami","tasklist","systeminfo","ipconfig","netstat","dir","type","findstr","node","npm","python","pip","curl"]'
```

### Windows scheduled task for auto-start

```cmd
schtasks /Create /SC ONSTART /TN "LandGodWorker" /TR "cmd /c cd /d C:\...\landgod && node .vite\build\headless-entry.js" /RU SYSTEM /F
```

### Windows shell_execute doesn't support shell features

`shell_execute` on Windows runs commands directly, NOT through `cmd.exe`. So:
- ❌ `echo hello && echo world` (shell chaining doesn't work)
- ❌ `for /f ...` (shell built-ins don't work)
- ✅ `hostname` (direct executables work)
- ✅ `python -c "print('hello')"` (works via python)

For complex Windows operations, use `python -c "..."` as the command.

## 🔧 MCP Server Configuration

### `remote_configure_mcp_server` defaults to experimental

Servers created via the remote API get `trustLevel: "experimental"`, which **blocks remote publication**. Tools won't appear in `/tools`.

**Fix:** Manually edit `managed-client.mcp-servers.json`:
```json
{"trustLevel": "trusted", "publishedRemotely": true}
```

### Tool names must match EXACTLY

The `tools` array in MCP config is a strict whitelist. Wrong names = tools silently don't appear.

```bash
# Verify actual tool names before configuring
printf '{"jsonrpc":"2.0","id":1,"method":"initialize",...}\n{"jsonrpc":"2.0","id":2,"method":"tools/list",...}\n' | npx @playwright/mcp
```

### MCP tools may take 10+ seconds to appear after worker start

Worker startup sequence:
1. Connect + register → 7 built-in tools appear
2. External MCP servers start (few seconds)
3. `update_tools` sent → full tool list appears

Don't panic if `/tools` shows only 7 tools right after restart.

## 📊 Monitoring Best Practices

### Resource awareness via `/clients`

```bash
curl -s http://localhost:8081/clients | python3 -c "
import sys,json
for c in json.load(sys.stdin)['clients']:
    r = c.get('resources',{})
    print(f\"{c['clientName']}: mem {r.get('usedMemoryPercent','-')}% load {r.get('loadAvg1m','-')}\")"
```

### Centralized audit

```bash
curl -s "http://localhost:8081/audit?limit=10"
```

### Worker reconnect behavior

Exponential backoff: 3s → 6s → 12s → 24s → 48s → 60s (cap). Resets on successful connection. Random jitter prevents thundering herd.

If a worker has been failing for a while, it may take up to 60 seconds to retry. Restarting the worker resets the backoff.

## 🚫 Things That Will Break

| Action | Consequence | Recovery |
|--------|-------------|----------|
| `npm install -g` worker | Config wiped | Re-configure |
| Restart Gateway with wrong token | All workers rejected | Fix token, wait for reconnect |
| Kill cloudflared | Cross-border workers lose connection | Restart tunnel, update URLs |
| Run two Gateway instances | Silent routing failures | Kill all, start one |
| Set `toolCallApprovalMode: manual` in headless | All tool_calls auto-rejected | Set to `auto` |
| Manual JSON edit with flat keys | Config silently ignored | Use `landgod config set` |
| `git add -A` in repo | node_modules committed | Use `git add <specific files>` |
| SCP packages between machines | Wrong platform binaries | Always install from GitHub URL |

## ✅ Operational Checklist

### Before deploying a new worker
- [ ] Gateway is running and healthy (`curl localhost:8081/health`)
- [ ] You have the Gateway token
- [ ] Network path is confirmed (same network / tunnel active)
- [ ] Node.js installed on target machine

### After deploying a new worker
- [ ] Worker appears in `curl localhost:8081/clients`
- [ ] `permissionProfile` is correct (test with `shell_execute hostname`)
- [ ] Stdout returns full output (not just `{"success":true}`)
- [ ] Keepalive is configured (cron/schtasks)

### After Gateway restart
- [ ] All workers reconnected (check `/clients` after 60 seconds)
- [ ] Quick Tunnel URL unchanged (or workers updated)
- [ ] Token matches all workers

### Regular health check
- [ ] `/health` returns ok
- [ ] `/clients` shows expected worker count
- [ ] `/audit` shows recent activity (not stale)
- [ ] No `rejected` entries in gateway.log
