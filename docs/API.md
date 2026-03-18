# CLI Server API Documentation

**Default Base URL:** `http://localhost:19876`

---

## 1. HTTP — Get Machine Info

### `GET /info`

Returns system information about the host machine.

**Response** `200 OK` `application/json`

```json
{
  "os": "Windows_NT 10.0.26220",
  "platform": "win32",
  "arch": "x64",
  "hostname": "MY-COMPUTER",
  "homedir": "C:\\Users\\username",
  "shell": "C:\\WINDOWS\\system32\\cmd.exe",
  "path": "C:\\WINDOWS\\system32;...",
  "uptime": 396236.14,
  "cpus": 20,
  "totalMemory": 34140872704,
  "freeMemory": 13642321920
}
```

| Field | Type | Description |
|-------|------|-------------|
| `os` | string | OS type + version (e.g. `Windows_NT 10.0.26220`, `Linux 6.1.0`) |
| `platform` | string | `win32` / `darwin` / `linux` |
| `arch` | string | `x64` / `arm64` / `ia32` |
| `hostname` | string | Machine hostname |
| `homedir` | string | Current user's home directory path |
| `shell` | string | Default shell path |
| `path` | string | System `PATH` environment variable |
| `uptime` | number | System uptime in seconds |
| `cpus` | number | Number of CPU cores |
| `totalMemory` | number | Total system memory in bytes |
| `freeMemory` | number | Available memory in bytes |

**CORS:** All origins allowed (`*`)

---

## 2. WebSocket — CLI Command Execution

### `ws://localhost:19876`

Each WebSocket connection handles **one command's** full lifecycle:

```
connect → execute → stream output → process exit → connection closed
```

---

### Client → Server Messages

#### `execute` — Run a command

```json
{
  "type": "execute",
  "command": "ls -la /tmp",
  "cwd": "/optional/working/directory"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"execute"` | ✅ | |
| `command` | string | ✅ | Shell command to execute |
| `cwd` | string | ❌ | Working directory (defaults to app process directory) |

> ⚠️ Only **one** `execute` message is allowed per connection. Sending a second will return an error.

#### `stdin` — Write to standard input

```json
{
  "type": "stdin",
  "data": "yes\n"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"stdin"` | ✅ | |
| `data` | string | ✅ | Text to write to the process stdin |

#### `kill` — Terminate the process

```json
{
  "type": "kill",
  "signal": "SIGTERM"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"kill"` | ✅ | |
| `signal` | string | ❌ | Signal name (default: `SIGTERM`) |

---

### Server → Client Messages

#### `started` — Process spawned

```json
{ "type": "started", "pid": 12345 }
```

| Field | Type | Description |
|-------|------|-------------|
| `pid` | number | OS process ID |

#### `stdout` — Standard output chunk

```json
{ "type": "stdout", "data": "hello world\n" }
```

| Field | Type | Description |
|-------|------|-------------|
| `data` | string | UTF-8 text from the process stdout |

#### `stderr` — Standard error chunk

```json
{ "type": "stderr", "data": "warning: ...\n" }
```

| Field | Type | Description |
|-------|------|-------------|
| `data` | string | UTF-8 text from the process stderr |

#### `exit` — Process exited

```json
{ "type": "exit", "code": 0, "signal": null }
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | number \| null | Exit code. `null` if killed by signal |
| `signal` | string \| null | Signal name if killed. `null` on normal exit |

> The server **automatically closes** the WebSocket connection after sending `exit`.

#### `error` — Error occurred

```json
{ "type": "error", "message": "Command already executing on this connection" }
```

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Human-readable error description |

---

### Interaction Examples

#### Basic Command Execution

```
Client                              Server
  │                                   │
  │──── WebSocket connect ───────────>│
  │                                   │
  │  {"type":"execute",               │
  │   "command":"echo hello"}         │
  │──────────────────────────────────>│
  │                                   │
  │<──────────────────────────────────│  {"type":"started","pid":1234}
  │<──────────────────────────────────│  {"type":"stdout","data":"hello\n"}
  │<──────────────────────────────────│  {"type":"exit","code":0,"signal":null}
  │                                   │
  │<──── connection closed ───────────│
```

#### Interactive Command (stdin required)

```
Client                              Server
  │                                   │
  │  {"type":"execute",               │
  │   "command":"python -i"}          │
  │──────────────────────────────────>│
  │<──────────────────────────────────│  {"type":"started","pid":5678}
  │<──────────────────────────────────│  {"type":"stdout","data":">>> "}
  │                                   │
  │  {"type":"stdin",                 │
  │   "data":"print('hi')\n"}        │
  │──────────────────────────────────>│
  │<──────────────────────────────────│  {"type":"stdout","data":"hi\n>>> "}
  │                                   │
  │  {"type":"kill"}                  │
  │──────────────────────────────────>│
  │<──────────────────────────────────│  {"type":"exit","code":null,"signal":"SIGTERM"}
  │<──── connection closed ───────────│
```

#### Error Handling

```
Client                              Server
  │                                   │
  │  {"type":"execute",               │
  │   "command":"nonexistent-cmd"}    │
  │──────────────────────────────────>│
  │<──────────────────────────────────│  {"type":"started","pid":9999}
  │<──────────────────────────────────│  {"type":"stderr","data":"'nonexistent-cmd' is not recognized..."}
  │<──────────────────────────────────│  {"type":"exit","code":1,"signal":null}
  │<──── connection closed ───────────│
```

---

### Implementation Notes

- Commands are executed via the system shell:
  - **Windows:** `cmd.exe /c <command>`
  - **macOS / Linux:** `/bin/sh -c <command>`
- Disconnecting the WebSocket automatically kills the child process
- All executions are logged to an audit log (stdout/stderr truncated to 10,000 characters per stream)
- The server port is configurable via the app's Settings UI (requires server restart)

### Security (MVP)

The current MVP has **no security restrictions**:

- No authentication / authorization
- No command blocklist
- No rate limiting
- CORS allows all origins

These will be addressed in the "Security Guardrails" feature in a future release.
