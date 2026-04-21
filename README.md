# 🏮 LandGod — Remote Device Management for AI Agents

LandGod enables AI agents to remotely manage devices distributed across different networks. Agents send HTTP requests to a Gateway, which forwards commands via WebSocket to Workers running on target machines.

## Architecture

```
                        ┌──────────────────┐
                        │    AI Agent       │
                        │  (any LLM agent)  │
                        └────────┬─────────┘
                                 │ HTTP :8081
                        ┌────────▼─────────┐
                        │    Gateway        │
                        │  (Node.js or Py)  │
                        └────────┬─────────┘
                                 │ WebSocket :8080
               ┌─────────────────┼─────────────────┐
               ▼                 ▼                  ▼
        ┌──────────┐      ┌──────────┐       ┌──────────┐
        │ Worker A │      │ Worker B │       │ Worker C │
        │ (Linux)  │      │ (Windows)│       │ (Cloud)  │
        └──────────┘      └──────────┘       └──────────┘
```

## Why LandGod? Architecture Comparison

### Approach 1: Agent per Device (Install AI agent on every machine)

```
┌─────────┐  ┌─────────┐  ┌─────────┐
│ Agent A │  │ Agent B │  │ Agent C │
│ + LLM   │  │ + LLM   │  │ + LLM   │
│ Device A│  │ Device B│  │ Device C│
└─────────┘  └─────────┘  └─────────┘
```

❌ **Expensive** — LLM API costs multiply with every device  
❌ **Hard to coordinate** — agents work independently, no centralized view  
❌ **Heavy footprint** — each device needs full agent runtime + config  
❌ **Secret sprawl** — API keys on every machine  

### Approach 2: Agent + SSH (One agent SSHs into devices)

```
┌─────────┐
│  Agent  │──SSH──→ Device A
│ + LLM   │──SSH──→ Device B
│         │──SSH──→ Device C
└─────────┘
```

⚠️ **SSH key management** — keys on agent machine, rotate across devices  
⚠️ **Firewall dependency** — needs SSH port open, blocked by some networks  
⚠️ **No persistent connection** — each command opens new SSH session  
⚠️ **Cross-border issues** — SSH tunnels through GFW are unreliable  
⚠️ **No tool abstraction** — agent must know each OS's shell syntax  

### Approach 3: LandGod (Gateway + Worker architecture) ✅

```
┌─────────┐         ┌─────────┐         ┌──────────┐
│  Agent  │──HTTP──→│ Gateway │──WS────→│ Worker A │
│ + LLM   │  :8081  │(1 inst) │  :8080  │ Device A │
└─────────┘         │         │────────→│ Worker B │
                    └─────────┘────────→│ Worker C │
                                        └──────────┘
```

✅ **One agent, many devices** — single LLM, single API key  
✅ **Workers are lightweight** — just Node.js, no LLM needed  
✅ **Workers connect outbound** — no inbound ports required, works behind NAT/firewall  
✅ **Cross-border ready** — WebSocket over Cloudflare Tunnel bypasses GFW  
✅ **Persistent connection** — always-on WebSocket, instant command execution  
✅ **Tool abstraction** — `shell_execute`, `file_read`, `session_create` work on any OS  
✅ **Security layers** — token auth + Ed25519 signing + command allowlist + approval mode  
✅ **Scalable** — add workers without touching the agent  
✅ **External MCP support** — workers can host MCP servers (e.g., Playwright browser)  

### Summary

| | Agent per Device | Agent + SSH | LandGod |
|---|---|---|---|
| LLM cost | N × cost | 1 × cost | 1 × cost |
| Setup per device | Heavy (agent + LLM) | Medium (SSH key) | Light (npm install) |
| Firewall friendly | ✅ | ❌ Need SSH port | ✅ Outbound only |
| Cross-border | ❌ | ⚠️ Unreliable | ✅ Cloudflare Tunnel |
| Persistent connection | ❌ | ❌ | ✅ WebSocket |
| Centralized control | ❌ | ⚠️ | ✅ Gateway API |
| Security | ⚠️ Keys everywhere | ⚠️ SSH keys | ✅ Token + signing |
| External tools (MCP) | ❌ | ❌ | ✅ |

## Components

| Package | Language | Type | Install |
|---------|----------|------|---------|
| `landgod` | Node.js | Worker (runs on managed devices) | `npm install -g landgod-0.1.0.tgz` |
| `landgod-gateway` | Node.js | Gateway server | `npm install -g landgod-gateway-0.1.0.tgz` |
| `landgod-gateway-server` | Python | Gateway server (supports Redis cluster) | `pip install landgod_gateway_server-0.1.0.whl` |
| `landgod_gateway` | Python | Client SDK | `pip install landgod_gateway-0.1.0.whl` |

All packages: [`downloads/`](downloads/)

## Quick Start

### 1. Install & Start Gateway

```bash
# Node.js
npm install -g https://github.com/zhou12138/cli-server/raw/master/downloads/landgod-gateway-0.1.0.tgz
landgod-gateway start --daemon --token YOUR_SECRET_TOKEN

# Or Python
pip install https://github.com/zhou12138/cli-server/raw/master/downloads/landgod_gateway_server-0.1.0-py3-none-any.whl
landgod-gateway-py start --token YOUR_SECRET_TOKEN
```

### 2. Install & Configure Worker

```bash
npm install -g https://github.com/zhou12138/cli-server/raw/master/downloads/landgod-0.1.0.tgz

landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "ws://GATEWAY_HOST:8080"
landgod config set token "YOUR_SECRET_TOKEN"
landgod config set toolCallApprovalMode auto
landgod config set builtInTools.permissionProfile full-local-admin

landgod daemon start --headless
```

### 3. Execute Commands

```bash
# Check online devices
curl http://localhost:8081/clients

# Run command on a device
curl -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{"clientName":"MY_DEVICE","tool_name":"shell_execute","arguments":{"command":"hostname"}}'

# List registered tools
curl http://localhost:8081/tools
```

## Gateway API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/clients` | List connected workers |
| GET | `/tools` | List registered tools per worker |
| POST | `/tool_call` | Execute command on worker |

## Worker Tools

| Tool | Description |
|------|-------------|
| `shell_execute` | Run shell commands |
| `file_read` | Read files |
| `remote_configure_mcp_server` | Install external MCP servers |
| `session_create/stdin/read_output/wait` | Interactive sessions |

Workers can also expose external MCP server tools (e.g., Playwright browser automation).

## Permission Profiles

| Profile | Use Case | Shell Commands |
|---------|----------|---------------|
| `command-only` | Read-only monitoring | echo, ls, cat, hostname, ps, df |
| `interactive-trusted` | Development | + git, node, npm, curl, find |
| `full-local-admin` | Full management | Everything |

## Network Connectivity

| Scenario | Worker Config | Method |
|----------|--------------|--------|
| Same machine | `ws://localhost:8080` | Direct |
| Same network | `ws://GATEWAY_IP:8080` | Open port |
| Cross-network | `ws://localhost:8080` | SSH reverse tunnel |
| Cross-border | `wss://xxx.trycloudflare.com` | Cloudflare Tunnel |

## Security

- **Token authentication** — Required on every WebSocket connection
- **Ed25519 signing** — Every tool_call is cryptographically signed
- **Command allowlist** — Per-profile shell command restrictions
- **Working directory restrictions** — Limit where commands can execute
- **Approval mode** — Optional manual approval for each command

## Project Structure

```
├── bin/                    CLI entry point (landgod.js)
├── src/                    Worker source code (TypeScript)
├── gateway/
│   ├── node-gateway/       Node.js Gateway server
│   ├── python-gateway/     Python Gateway server
│   └── python-sdk/         Python client SDK
├── downloads/              Release packages
├── docs/                   Documentation
├── examples/               Deployment examples
├── skills/                 Agent Skills (landgod-deploy, landgod-operate)
├── scripts/                Deployment scripts
└── Makefile                Build all packages
```

## Build

```bash
make clean && make    # Build all packages → downloads/
```

## Documentation

- [`docs/`](docs/) — Technical documentation
- [`examples/`](examples/) — Deployment guide with real-world example
- [`skills/landgod-deploy/`](skills/landgod-deploy/) — Skill for deploying LandGod
- [`skills/landgod-operate/`](skills/landgod-operate/) — Skill for operating devices

## License

MIT
