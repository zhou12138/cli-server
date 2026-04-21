# Changelog

All notable changes to LandGod will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.1] — 2026-04-21

### Added
- **Worker labels** — Workers declare capabilities via `labels` config (`{"gpu":true,"region":"us"}`)
- **Label-based routing** — `POST /tool_call` with `{"labels":{"gpu":true}}` auto-finds matching worker
- **Resource awareness** — Workers report CPU/memory/load every 60s, visible in `GET /clients`
- **Resource heartbeat** — `resource_heartbeat` WebSocket method updates stored resource data
- **Async tasks** — `POST /tool_call?async=true` returns `taskId` immediately, executes in background
- **Task queue** — `POST /tool_call?queue=true` queues tasks for offline workers, auto-drains on reconnect
- **`GET /tasks`** — List all async and queued tasks with status filter
- **`GET /tasks/:id`** — Get individual task status and result
- **`POST /batch_tool_call`** — Parallel batch execution on multiple workers (Node.js + Python)
- **`GET /audit`** — Centralized audit log viewer across all workers
- **`landgod mcp show`** — Display MCP server configuration
- **`landgod-dispatch` skill** — AI agent task scheduling (labels, async, queue, batch, resources)
- **Worker exponential backoff** — Reconnect with jitter (3s→60s cap), resets on success

### Changed
- Single-token authentication mode, removed `tokens.json`
- Token must be set via `--token` or `LANDGOD_AUTH_TOKEN`
- Gateway without token fails to start (no silent defaults)
- Directory restructure: `sdk-node` → `node-gateway`, `sdk-python` → `python-sdk`
- Documentation reorganized with index, consistent numbering, English CHANGELOG
- `.gitignore` updated, removed 131 tracked build artifacts
- Makefile includes headless-entry.js + Python Gateway Server build targets
- README rewritten with architecture comparison (Agent-per-Device vs SSH vs LandGod)
- Python Gateway fully synced: labels, resources, batch, async, queue, audit

### Fixed
- Gateway `clientName` routing returns 404 when worker not found
- Worker `permissionProfile` lost during config serialization
- `headless-entry.ts` ROOT_DIR path (Windows compatibility)
- `headless-entry.ts` `runtime.start()` Promise handling crash
- `toolCallApprovalMode` defaulting to `manual` caused auto-reject in headless
- Node.js Gateway daemon `--token` not passed to child process
- websockets 16 API compatibility (Python Gateway)
- Makefile `cd` fallback bug in Python build commands

## [0.1.0] — 2026-04-16
- **Async tasks** (`POST /tool_call?async=true`) — Returns `taskId` immediately, executes in background
- **Task queue** (`POST /tool_call?queue=true`) — Queues tasks for offline workers, auto-drains on reconnect
- **`GET /tasks`** / **`GET /tasks/:id`** — List and query async/queued task status
- **Worker labels** — Workers declare capabilities via `labels` config, sent during registration
- **Label-based routing** — Route tool_call by labels (`{"labels":{"gpu":true}}`) instead of hardcoded clientName
- **Resource awareness** — Workers report CPU/memory/load every 60s, visible in `GET /clients`
- **`landgod-dispatch` skill** — AI agent task scheduling skill (labels, async, queue, batch, resources)
- **`GET /tools`** — List registered tools per worker
- **`landgod mcp show`** — Display MCP server configuration
- **`landgod daemon start --headless`** — Pure Node.js headless mode, no Electron needed
- **`--token` CLI argument** — Specify token at startup, no more hardcoded defaults
- **Agent Skills** — `landgod-deploy` and `landgod-operate` for AI agent integration

### Changed
- Single-token authentication mode, removed `tokens.json`
- Token must be set via `--token` or `LANDGOD_AUTH_TOKEN` environment variable
- Gateway without token now fails to start (no silent defaults)
- Worker reconnect uses exponential backoff with jitter (3s→60s cap), resets on success
- Directory restructure: `sdk-node` → `node-gateway`, `sdk-python` → `python-sdk`
- Removed duplicate `gateway/server/` directory
- Documentation reorganized: renumbered, renamed, added index
- Reference docs (architecture, gui-vs-headless) no longer use numeric prefix
- `.gitignore` updated, removed 131 tracked build artifacts
- Makefile includes `headless-entry.js` build step via esbuild
- README rewritten as clean project introduction with architecture comparison

### Fixed
- Gateway `clientName` routing returns 404 when worker not found (was silently routing to wrong worker)
- Worker `permissionProfile` lost during config serialization
- `headless-entry.ts` ROOT_DIR path (Windows compatibility)
- `headless-entry.ts` `runtime.start()` Promise handling crash
- `toolCallApprovalMode` defaulting to `manual` caused auto-reject in headless mode
- Node.js Gateway daemon `--token` argument not passed to child process
- websockets 16 API compatibility (Python Gateway)

## [0.1.0] — 2026-04-16

### Added
- **LandGod Worker** (`landgod`) — Remote execution agent
  - GUI mode (Electron) and Headless mode (pure Node.js)
  - 7 built-in tools: `shell_execute`, `file_read`, `session_create`/`stdin`/`read_output`/`wait`, `remote_configure_mcp_server`
  - 3 permission profiles: `command-only` (19 commands), `interactive-trusted` (32), `full-local-admin` (47)
  - `landgod onboard` — interactive configuration wizard
  - `landgod start/stop/status/audit/config/--version`
  - Ed25519 signature verification, command allowlist, directory restrictions, audit log

- **LandGod Gateway** (`landgod-gateway`) — Agent sidecar gateway
  - HTTP API (`:8081`) for agent requests
  - WebSocket (`:8080`) for worker connections
  - Single-instance protection: kills old process on start
  - `landgod-gateway start/stop/status/--version`

- **Python SDK** (`landgod_gateway`) — Gateway client SDK
  - Memory and Redis state storage
  - `pip install landgod-gateway[redis]`

- **Deployment tools**
  - `landgod-deploy.sh` — Linux remote deployment script
  - `landgod-deploy.ps1` — Windows remote deployment script
  - Configuration templates (command-only, full-admin)

- **Documentation**
  - Network prerequisites, Gateway API, MCP-WS protocol
  - Deploy guides for Gateway and Worker
  - Architecture comparison, GUI vs Headless

### Security
- Removed `bash`/`sh` from default command allowlist
- Security warning when configuring dangerous shell paths

### Removed
- HTTP polling mode (only WebSocket `mcp-ws` mode retained)
- Legacy `XClawNode` / `clawnode` naming
