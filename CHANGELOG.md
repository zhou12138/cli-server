# Changelog

All notable changes to LandGod will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0-rc2] — 2026-04-21

### Added
- **Python Gateway Server** (`landgod-gateway-server`) — Full Python Gateway
  - Single-node (memory) and distributed (Redis) deployment
  - WebSocket + HTTP API, protocol-compatible with Node.js Gateway
  - `landgod-gateway-py start [--token TOKEN] [--redis URL]`
- **`GET /tools`** — List registered tools per worker
- **`landgod mcp show`** — Display MCP server configuration
- **`landgod daemon start --headless`** — Pure Node.js headless mode, no Electron needed
- **`--token` CLI argument** — Specify token at startup, no more hardcoded defaults
- **Agent Skills** — `landgod-deploy` and `landgod-operate` for AI agent integration

### Changed
- Single-token authentication mode, removed `tokens.json`
- Token must be set via `--token` or `LANDGOD_AUTH_TOKEN` environment variable
- Gateway without token now fails to start (no silent defaults)
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
