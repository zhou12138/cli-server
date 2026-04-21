# 🚀 Quick Start: Install Worker

> Worker runs on each managed device. It connects outbound to the Gateway via WebSocket.

## Install

```bash
npm install -g https://github.com/zhou12138/cli-server/raw/master/downloads/landgod-0.1.1.tgz
```

## Configure

```bash
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "ws://GATEWAY_HOST:8080"
landgod config set token "YOUR_SECRET_TOKEN"
landgod config set toolCallApprovalMode auto
```

### Permission Profiles

Choose one:

**Minimal (read-only monitoring)**
```bash
landgod config set builtInTools.permissionProfile command-only
```

**Development (common tools)**
```bash
landgod config set builtInTools.permissionProfile interactive-trusted
```

**Full admin (everything)**
```bash
landgod config set builtInTools.permissionProfile full-local-admin
```

> ⚠️ Do **not** add `bash` or `sh` to the command allowlist — they bypass all restrictions.

## Start

```bash
# Headless mode (recommended for servers)
landgod daemon start --headless

# Electron mode (if you need GUI)
landgod daemon start
```

### Headless vs Electron

| | Headless ✅ | Electron |
|---|---|---|
| Extra install | None | ~170MB + system deps |
| Cross-platform | Linux/Mac/Windows | Mainly Linux |
| UI | No | Yes |

## Verify

On the Gateway machine:
```bash
curl -s http://localhost:8081/clients
```

You should see your device in the list.

## Replace Placeholders

- `GATEWAY_HOST` — Gateway machine address (`localhost` if same machine, IP if remote)
- `YOUR_SECRET_TOKEN` — Must match the Gateway's `--token` value

## Network Connectivity

| Scenario | `bootstrapBaseUrl` |
|----------|--------------------|
| Same machine | `ws://localhost:8080` |
| Same network | `ws://192.168.x.x:8080` |
| SSH tunnel | `ws://localhost:8080` (via reverse tunnel) |
| Cross-border | `wss://your-domain.trycloudflare.com` (Cloudflare Tunnel) |

See [docs/01-network-prerequisites.md](../docs/01-network-prerequisites.md)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Electron is not installed` | Use `--headless` mode |
| `Missing X server` | Use `--headless` mode |
| `command not found: landgod` | Run `hash -r` or restart shell |
| Can't connect to Gateway | Check network/firewall/tunnel |

## Next

→ [Full documentation](../docs/)
