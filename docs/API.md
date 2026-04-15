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

---

## 3. Managed Client Runtime (Demo)

This app can also run as a managed CLI client for a remote backend that exposes the demo protocol described below:

- `POST /client-runtime/register`
- `POST /client-runtime/heartbeat`
- `GET /client-runtime/tasks/next?client_id=...&wait_seconds=20`
- `POST /client-runtime/tasks/{task_id}/complete`

### Supported Commands

The managed client currently supports these `command_name` values:

- `run_command`
- `read_file`

`run_command` payload example:

```json
{
  "command": "git status",
  "cwd": "C:\\edge_workspace\\cli-server"
}
```

`read_file` payload example:

```json
{
  "path": "C:\\edge_workspace\\cli-server\\package.json",
  "encoding": "utf-8",
  "max_bytes": 65536
}
```

### Run Managed Client With Existing UI

If you want to keep using the current CLI Server UI while managed client runtime is enabled, start it in non-headless mode:

Recommended default configuration source: system environment variables.

```powershell
$env:ENABLE_MANAGED_CLIENT_RUNTIME="true"
$env:MANAGED_CLIENT_BASE_URL="http://localhost:8000/api"
```

```powershell
npm run start:managed-client-ui
```

In this mode:

- The existing Electron UI still starts
- The embedded local CLI server does not start
- The managed client runtime starts in the same main process
- `run_command` tasks reuse `SessionManager`, so command execution continues to appear in the existing Dashboard and Audit Log views
- This mode is mutually exclusive with the normal CLI Server mode
- The startup guide page can also collect Azure AD settings and trigger an interactive MFA sign-in before runtime startup

### Run Headless Managed Client

By default, startup configuration should come from system environment variables:

```powershell
$env:ENABLE_MANAGED_CLIENT_RUNTIME="true"
$env:MANAGED_CLIENT_BASE_URL="http://localhost:8000/api"
npm run start:managed-client
```

If needed, a project-level fallback config file is also supported:

```json
// managed-client.config.json
{
  "baseUrl": "http://localhost:8000/api"
}
```

Config resolution order is:

- CLI flags
- UI bootstrap page saved URL (`bootstrapBaseUrl`)
- UI bootstrap page saved AAD settings (`bootstrapAadClientId`, `bootstrapAadTenantId`, `bootstrapAadScopes`, `bootstrapAadRedirectUri`)
- system environment variables
- `managed-client.config.json` fallback

If the UI bootstrap page is used, it writes a higher-priority value into the same file:

```json
// managed-client.config.json
{
  "bootstrapBaseUrl": "http://machine-specific-host:8000/api",
  "bootstrapAadClientId": "00000000-0000-0000-0000-000000000000",
  "bootstrapAadTenantId": "common",
  "bootstrapAadScopes": ["api://your-app-id/.default"],
  "bootstrapAadRedirectUri": "http://localhost",
  "baseUrl": "http://localhost:8000/api"
}
```

Then start the headless client:

```powershell
npm run start:managed-client
```

If you want to override the file config for one terminal session, set:

```powershell
$env:MANAGED_CLIENT_BASE_URL="https://your-backend.example.com"
```

If your demo backend still expects auth, set:

```powershell
$env:MANAGED_CLIENT_BEARER_TOKEN="<same-user-bearer-token>"
```

Optional environment variables:

- `ENABLE_MANAGED_CLIENT_RUNTIME=true`
- `MANAGED_CLIENT_NAME=weiwei-laptop`
- `MANAGED_CLIENT_WAIT_SECONDS=20`
- `MANAGED_CLIENT_RETRY_MS=3000`
- `MANAGED_CLIENT_AAD_CLIENT_ID=<azure-ad-app-client-id>`
- `MANAGED_CLIENT_AAD_TENANT_ID=common`
- `MANAGED_CLIENT_AAD_SCOPES=api://your-app-id/.default`
- `MANAGED_CLIENT_AAD_REDIRECT_URI=http://localhost`

In `managed-client-mcp-ws` mode, the desktop node can publish these built-in MCP tools upstream:

- `shell_execute`
- `file_read`
- `remote_configure_mcp_server`
- `session_create`
- `session_stdin`
- `session_wait`
- `session_read_output`

For interactive commands such as `github-copilot-cli auth`, prefer the session tool chain instead of `shell_execute`:

1. `session_create` with `enableStdin=true`
2. `session_wait` to detect first prompt or output idle
3. `session_read_output` to inspect stdout/stderr
4. `session_stdin` to send replies such as `\n`, codes, or confirmation input
5. Repeat `session_wait` + `session_read_output` until exit or completion

Equivalent CLI flags are also supported:

- `--enable-managed-client-runtime`
- `--managed-client-only`
- `--managed-client-base-url=...`
- `--managed-client-token=...`
- `--managed-client-aad-client-id=...`
- `--managed-client-aad-tenant-id=...`
- `--managed-client-aad-scopes=...`
- `--managed-client-aad-redirect-uri=...`
- `--managed-client-name=...`
- `--managed-client-wait-seconds=20`
- `--managed-client-retry-ms=3000`

If `MANAGED_CLIENT_AAD_CLIENT_ID` and `MANAGED_CLIENT_AAD_SCOPES` are configured in `start:managed-client-ui`, the setup page will open an Azure AD browser sign-in flow and use the acquired access token for managed-client requests.

Recommended startup modes:

- `npm run start`: regular CLI Server UI + local server only
- `npm run start:managed-client-ui`: CLI Server UI + managed client runtime only
- `npm run start:managed-client`: managed client runtime only, no UI
