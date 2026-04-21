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
