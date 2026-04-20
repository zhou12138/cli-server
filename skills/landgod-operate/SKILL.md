---
name: landgod-operate
description: "Operate remote devices through LandGod Gateway. Use when: executing commands on remote machines, reading files, scanning for security issues, batch operations across multiple devices, checking device status, or any task that requires interacting with remote workers via the LandGod HTTP API. Triggers on: run command on, execute on, check device, list workers, remote scan, batch execute, tool_call, landgod operate."
---

# LandGod Operate Skill

Execute commands and manage remote devices through the LandGod Gateway HTTP API.

## Gateway API

Default: `http://localhost:8081` (adjust if gateway is on a different host).

## Check Status

```bash
# Gateway health
curl -s http://localhost:8081/health

# List online workers
curl -s http://localhost:8081/clients
```

Parse clients response:
```python
import json, subprocess
result = subprocess.run(["curl", "-s", "http://localhost:8081/clients"], capture_output=True, text=True)
clients = json.loads(result.stdout).get("clients", [])
for c in clients:
    print(f"🟢 {c['clientName']}")  # or 🔴 if not connected
```

## Execute Command on a Device

```bash
curl -s -m 30 -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{"clientName":"DEVICE_NAME","tool_name":"shell_execute","arguments":{"command":"YOUR_COMMAND"}}'
```

### Parse response

The response is a JSON envelope. Extract stdout:

```bash
# One-liner parse
curl -s -m 30 -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{"clientName":"ZhouTest1","tool_name":"shell_execute","arguments":{"command":"hostname"}}' \
  | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(json.loads(d['payload']['data']['text']).get('stdout','').strip())"
```

Response structure:
```json
{
  "type": "event",
  "event": "tool_result_chunk",
  "payload": {
    "data": {
      "text": "{\"stdout\":\"...\",\"stderr\":\"...\",\"exit_code\":0,\"signal\":null,\"cwd\":\"...\"}"
    },
    "is_final": false
  }
}
```

### Error responses

- **404** `{"error":"No connected client named: XXX"}` — device offline or name wrong
- **tool_error** with `tool_execution_failed` — command blocked by allowlist or execution error

## Routing Rules

- `{"clientName":"ZhouTest1"}` — route by device name (recommended)
- `{"connection_id":"conn-xxx"}` — route by connection ID (from /clients)
- Neither specified — routes to first connected device (avoid this)
- ⚠️ If `clientName` not found, returns 404 (never silently routes elsewhere)

## Available Tools

| Tool | Description | Example |
|------|-------------|---------|
| `shell_execute` | Run shell command | `{"command":"ls -la"}` |
| `file_read` | Read file content | `{"path":"/etc/hostname"}` |
| `remote_configure_mcp_server` | Install/update MCP server on worker | See MCP section below |
| `session_create` | Create interactive session | `{"command":"python3"}` |
| `session_stdin` | Send input to session | `{"sessionId":"...","data":"print('hi')\\n"}` |
| `session_read_output` | Read session output | `{"sessionId":"...","stream":"stdout"}` |
| `session_wait` | Wait for session state | `{"sessionId":"...","exited":true}` |

## Remote MCP Server Configuration

Install or update external MCP servers on workers remotely via `remote_configure_mcp_server`.

⚠️ Requires worker `permissionProfile` = `full-local-admin` and `managedMcpServerAdmin.enabled = true`.

### Install HTTP MCP server
```bash
curl -s -m 30 -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{
    "clientName":"ZhouTest1",
    "tool_name":"remote_configure_mcp_server",
    "arguments":{
      "name":"my-mcp-service",
      "transport":"http",
      "url":"http://localhost:3000/mcp",
      "tools":["tool1","tool2"],
      "published_remotely":true
    }
  }'
```

### Install stdio MCP server
```bash
curl -s -m 30 -X POST http://localhost:8081/tool_call \
  -H "Content-Type: application/json" \
  -d '{
    "clientName":"ZhouTest1",
    "tool_name":"remote_configure_mcp_server",
    "arguments":{
      "name":"playwright",
      "transport":"stdio",
      "command":"npx",
      "args":["@anthropic/mcp-playwright"],
      "tools":["browser_navigate","browser_screenshot"],
      "published_remotely":true
    }
  }'
```

### Trust levels
- `experimental` (default for remote-created) — local only, not published upstream
- `trusted` — published remotely (must be manually promoted by device owner)
- `blocked` — disabled

New servers created via `remote_configure_mcp_server` default to `experimental`. The device operator must promote to `trusted` before tools are published upstream.

## Batch Operations

### Execute same command on all devices
```bash
for client in $(curl -s http://localhost:8081/clients | python3 -c "
import sys,json
for c in json.load(sys.stdin).get('clients',[]):
    print(c['clientName'])
"); do
  echo "=== $client ==="
  curl -s -m 30 -X POST http://localhost:8081/tool_call \
    -H "Content-Type: application/json" \
    -d "{\"clientName\":\"$client\",\"tool_name\":\"shell_execute\",\"arguments\":{\"command\":\"hostname && uname -a\"}}"
  echo ""
done
```

### Using Python SDK
```python
from landgod_gateway import LandGod
import asyncio

async def main():
    link = LandGod('http://localhost:8081')
    
    # List devices
    clients = await link.clients()
    
    # Execute on one device
    result = await link.execute('hostname', target='ZhouTest1')
    print(result['stdout'])
    
    # Broadcast to all
    results = await link.broadcast('uname -a')
    for r in results:
        print(f"{r['device']}: {r.get('stdout','error')}")

asyncio.run(main())
```

## Common Operations

### Security scan
```bash
# Check for suspicious processes
curl -s -m 30 -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"DEVICE","tool_name":"shell_execute","arguments":{"command":"ps aux | grep -iE \"miner|xmrig|crypto|kinsing\" | grep -v grep"}}'

# Check SSH brute force attempts
curl -s -m 30 -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"DEVICE","tool_name":"shell_execute","arguments":{"command":"grep \"Failed password\" /var/log/auth.log | tail -10"}}'

# Check listening ports
curl -s -m 30 -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"DEVICE","tool_name":"shell_execute","arguments":{"command":"ss -tlnp"}}'
```

### System info
```bash
# Disk usage
{"command":"df -h /"}

# Memory
{"command":"free -h"}

# Uptime + load
{"command":"uptime"}

# OS info
{"command":"cat /etc/os-release | head -5"}
```

### Windows commands
```bash
# Process list (Windows)
{"command":"tasklist"}

# Network connections (Windows)
{"command":"netstat -an"}

# System info (Windows)
{"command":"systeminfo | findstr /B /C:\"OS Name\" /C:\"Total Physical Memory\""}
```

## Timeouts

- Default Gateway timeout: **30 seconds**
- For long-running commands, pass `timeout` parameter:
  ```json
  {"clientName":"X","tool_name":"shell_execute","arguments":{"command":"long-cmd"},"timeout":120000}
  ```
- ⚠️ Commands exceeding timeout will be killed on the worker side

## Permission Profiles

Worker allowlist controls what commands can run:

| Profile | Allowed | Blocked |
|---------|---------|---------|
| `command-only` | echo, ls, cat, hostname, ps | npm, git, curl, rm |
| `interactive-trusted` | + git, node, npm, curl, find | rm, chmod, wget |
| `full-local-admin` | everything | nothing |

If a command is blocked: `"error":"Executable is outside the allowlist: xxx"`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `No connected client named` | Device offline — check worker process |
| `tool_call timeout` | Command too slow or worker unresponsive — increase timeout or restart worker |
| `Executable is outside the allowlist` | Change worker's `permissionProfile` to `full-local-admin` |
| `{success: true}` only, no stdout | Worker profile is `command-only` — change to `full-local-admin` |
| `user_rejected` | `toolCallApprovalMode` is `manual` — set to `auto` |
