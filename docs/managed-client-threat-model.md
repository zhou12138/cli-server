# Managed Client Threat Model Checklist

## Scope

This checklist covers the current `managed-client-mcp-ws` implementation in `cli-server`, with focus on four layers of risk:

1. Built-in tools
2. External MCP servers
3. Transport and network path
4. Configuration and secret storage

The goal is not to claim the current implementation is safe. The goal is to identify where sensitive local information can leave the machine, what controls exist today, and what changes are needed to reach a defensible baseline.

## Implemented Permission Profiles

The desktop node now supports three enforced permission profiles in Built-in Tools settings:

1. `command-only`
2. `interactive-trusted`
3. `full-local-admin`

Current runtime behavior:

- `command-only`: publishes only the command execution surface needed to accept remote commands. Successful tool calls return success status only, not command output or file content. External MCP publication stays disabled.
- `interactive-trusted`: publishes a small interactive handle surface such as `session_create`, `session_stdin`, and `session_wait`. Successful calls still avoid returning command stdout, file content, or other result bodies. External MCP publication stays disabled.
- `full-local-admin`: keeps the full local tool surface, allows unrestricted `file_read`, permits external MCP publication, and returns full tool results upstream. This mode is intended only for explicitly trusted administrator environments.

The selected profile is not just UI metadata. It is enforced in three places:

1. Built-in tool policy normalization and persistence
2. Runtime tool publication and success-result egress behavior
3. External MCP server loading and publication

---

## Threat Model Summary

### Assets At Risk

- Local source code and workspace files
- Secrets in `.env`, config files, shell history, SSH keys, tokens, cookies, browser profiles
- Environment variables injected into Electron or child processes
- Database contents reachable by configured MCP servers
- Access tokens used for managed-client WebSocket authentication
- Command output and error output produced on the local machine

### Trust Boundaries

1. Remote MCP Hub to local desktop node
2. Local desktop node to built-in tool executor
3. Local desktop node to external MCP server process or HTTP server
4. Local config files to runtime process
5. Runtime process to audit logs and UI status surfaces

### Primary Data Egress Paths

1. Tool results returned to remote MCP Hub through `tool_result_chunk`
2. External MCP servers making their own outbound network requests
3. Cleartext or weakly protected config files on disk
4. Non-TLS transport carrying tokens or tool results

---

## Layer 1: Built-in Tools

### Current Attack Surface

- `shell_execute`
- `session_create`
- `session_stdin`
- `session_wait`
- `session_read_output`
- `file_read`
- `managed_mcp_server_upsert`

These tools can be published upstream in `managed-client-mcp-ws` mode and their results can be sent back to the remote side.

### Sensitive Information Exposure Scenarios

1. `file_read` reads `.env`, SSH keys, browser state, config files, tokens, source files, or secrets under the user profile.
2. `shell_execute` or session tools run PowerShell commands that print environment variables, credential files, Git config, cloud CLI tokens, or password manager exports.
3. Interactive session tools enable multi-step probing of the local machine instead of a single command.
4. `managed_mcp_server_upsert` can add a new MCP server that expands the data-exfil surface if governance is enabled.

### Current Controls

- `shell_execute` supports command blocking, executable blocking, working-directory blocking, optional network-command blocking, timeout caps, and workspace-root enforcement for cwd.
- `file_read` supports path allow-lists, blocked paths, blocked extensions, byte limits, and file size limits.
- Managed workspace defaults reduce uncontrolled file writes.
- `managed_mcp_server_upsert` is disabled by default.

### Current Gaps

1. Default built-in policy is permissive.
2. `shellExecute.enabled` defaults to `true`.
3. `blockNetworkCommands` defaults to `false`.
4. `fileRead.allowedPaths` defaults to empty, which currently means unrestricted reads instead of deny-by-default.
5. Session tools are enabled together with `shell_execute`, so interactive local inspection is exposed when shell execution is enabled.
6. There is no result-level redaction pass before tool output is sent back upstream.
7. There is no distinction between local execution permission and remote egress permission.

### Risk Rating

- Confidentiality: High
- Integrity: Medium
- Availability: Medium

### Remediation Checklist

#### Immediate

- [ ] Default `shellExecute.enabled` to `false` for managed-client production mode.
- [ ] Default `blockNetworkCommands` to `true`.
- [ ] Split session tools from `shell_execute` with a dedicated `interactiveSessions.enabled` switch.
- [ ] Default `fileRead.allowedPaths` to the managed workspace current directory only.
- [ ] Add blocked defaults for obvious sensitive roots such as user SSH directories, browser profile directories, cloud credential directories, and system key stores.
- [ ] Disable `managed_mcp_server_upsert` unless the node is in an explicitly trusted admin mode.

#### Short Term

- [ ] Add a tool-result egress filter that detects and masks common secret patterns before sending results upstream.
- [ ] Add an allow-list of safe executables instead of relying only on block-lists.
- [ ] Add a per-tool publish switch so the desktop node can expose `file_read` without exposing shell execution.
- [ ] Add policy-driven limits for session lifetime, stdout size, stderr size, and number of interactive writes.

#### Medium Term

- [ ] Add a capability model that separates `execute locally`, `return locally`, and `return remotely`.
- [ ] Add approval gates for dangerous tool categories when a remote side asks for them.
- [ ] Add structured result types for built-in tools so sensitive fields can be redacted precisely instead of with regex-only filtering.

---

## Layer 2: External MCP Servers

### Current Attack Surface

- HTTP MCP servers configured in managed-client config
- stdio MCP servers launched as local child processes
- Tool sets from those servers published upstream with a prefix

### Sensitive Information Exposure Scenarios

1. A stdio MCP server reads arbitrary local files directly using its own code, independent of host `file_read` restrictions.
2. A stdio MCP server reads process environment variables, including credentials injected through config.
3. A stdio MCP server makes outbound network calls and sends local data to third-party services.
4. An HTTP MCP server points to an untrusted endpoint that already has remote egress and can aggregate local requests or sensitive content.
5. A tool allow-list of `"*"` exposes the entire external server surface upstream.

### Current Controls

- External tool publication supports tool prefixing.
- External configs can restrict the published tool set.
- Stdio `cwd` is constrained to the managed workspace root when configured through current runtime.
- `managed_mcp_server_upsert` policy can forbid new stdio servers by default.

### Current Gaps

1. `cwd` restriction is not a sandbox. External servers can still open absolute paths, inspect env vars, and call the network.
2. Existing external MCP configs are loaded if present, even when their effective trust level is high.
3. Tool allow-lists can be `"*"`, which removes effective minimization.
4. There is no server signing, attestation, or provenance validation.
5. There is no egress policy around external MCP network access.
6. Stdio servers inherit trust from the local machine but are treated operationally like normal tools.

### Risk Rating

- Confidentiality: High
- Integrity: High
- Availability: Medium

### Remediation Checklist

#### Immediate

- [ ] Default external MCP loading to disabled unless each server is explicitly approved.
- [ ] Forbid `tools: ["*"]` in production profiles.
- [ ] Default to allowing HTTP MCP only; keep stdio MCP disabled unless there is a clear business requirement.
- [ ] Require per-server trust labels such as `trusted`, `internal-only`, `experimental`, `blocked`.
- [ ] Remove secrets from MCP server command arguments and environment blocks where possible.

#### Short Term

- [ ] Add per-server publish toggles separate from per-server local connectivity.
- [ ] Add a server review manifest that records owner, purpose, data classification, outbound network behavior, and secret dependencies.
- [ ] Add warnings or refusal when a stdio MCP server requests broad tools and broad network access together.
- [ ] Restrict inherited environment variables for stdio MCP child processes.

#### Medium Term

- [ ] Run untrusted stdio MCP servers in a sandboxed worker process or container boundary.
- [ ] Add outbound network allow-listing for external MCP servers.
- [ ] Add server binary integrity checks or package provenance checks before launch.

---

## Layer 3: Transport And Network Path

### Current Attack Surface

- Managed-client WebSocket connection to remote MCP Hub
- Token passed as `access_token` query parameter
- Tool results streamed back to the remote endpoint
- External MCP HTTP transport

### Sensitive Information Exposure Scenarios

1. A base URL using `http://` becomes `ws://`, exposing access tokens and tool results to network observers.
2. Query-string tokens may appear in reverse proxy logs, browser-equivalent telemetry, or upstream request logs.
3. Tool results may contain local secrets and traverse the network without content filtering.
4. External HTTP MCP endpoints may run over insecure transport if misconfigured.

### Current Controls

- URL normalization supports `https://` to `wss://`.
- The runtime can operate against explicit secure endpoints.
- There is a single well-defined upstream event path for tool result return.

### Current Gaps

1. Non-TLS `http://` and `ws://` are still accepted.
2. Access tokens are placed in query parameters.
3. There is no certificate pinning or stronger peer verification beyond normal TLS.
4. There is no response classification or transport-level DLP before sending tool output.
5. Audit logs may record connection metadata that includes the final URL shape.

### Risk Rating

- Confidentiality: High
- Integrity: Medium
- Availability: Low to Medium

### Remediation Checklist

#### Immediate

- [ ] Require `https://` or `wss://` in production mode.
- [ ] Refuse cleartext managed-client connections by default.
- [ ] Move away from query-string tokens where backend compatibility allows it.
- [ ] Scrub tokens from all logs and audit entries regardless of transport.

#### Short Term

- [ ] Add a transport security mode flag such as `strictTls=true`.
- [ ] Add configuration validation that rejects insecure external HTTP MCP URLs.
- [ ] Introduce payload classification for tool results before upstream send.

#### Medium Term

- [ ] Use short-lived delegated tokens scoped specifically for desktop node sessions.
- [ ] Add mutual TLS or stronger node identity binding if the deployment model warrants it.
- [ ] Add per-tenant egress policies and audit trails for high-risk tool outputs.

---

## Layer 4: Configuration Files And Secret Storage

### Current Attack Surface

- `managed-client.config.json`
- `managed-client.mcp-servers.json`
- Environment variables used by Electron and child processes
- Any secrets persisted in command args, URLs, or env blocks

### Sensitive Information Exposure Scenarios

1. Database credentials are stored directly in config files.
2. Personal access tokens or service tokens are stored in env blocks for child processes.
3. Config files can be read by local users, malware, backups, or accidental source control commits.
4. Secrets stored in command arguments can show up in process listings, crash logs, or diagnostic output.
5. Migrated or legacy config paths may retain secrets even after newer governance is added.

### Current Controls

- Managed client config is centralized.
- External MCP server persistence is separated into a dedicated file.
- `managed_mcp_server_upsert` is disabled by default.

### Current Gaps

1. Secrets may still be stored in plain text on disk.
2. There is no secret-store integration.
3. There is no encryption-at-rest for local config.
4. There is no config linter to reject obviously sensitive material in unsafe fields.
5. There is no Git hygiene enforcement to prevent accidental commit of local secret-bearing config files.

### Risk Rating

- Confidentiality: High
- Integrity: Medium
- Availability: Low

### Remediation Checklist

#### Immediate

- [ ] Remove plaintext credentials from MCP config files.
- [ ] Move secrets to OS keychain, Windows Credential Manager, or environment injection at runtime.
- [ ] Add `.gitignore` and repository checks to ensure local runtime config files are never committed.
- [ ] Prohibit secrets in command-line args when an env or secure secret reference can be used instead.

#### Short Term

- [ ] Add a config validator that detects likely secrets in URLs, args, env values, and JSON fields.
- [ ] Add masked display and masked logging for any secret-bearing config values.
- [ ] Separate server definition from secret material by storing only references in config.

#### Medium Term

- [ ] Integrate a proper secret provider abstraction for local managed-client runtime.
- [ ] Rotate tokens or database passwords automatically when a config leak is suspected.
- [ ] Add secure export and import flows for managed-client configuration without raw secret disclosure.

---

## Cross-Layer Priority Actions

These are the highest-value changes across all four layers.

### P0

- [ ] Enforce TLS-only upstream connections.
- [ ] Default built-in shell and interactive session execution to off.
- [ ] Default file reads to managed workspace allow-list only.
- [ ] Stop storing plaintext credentials in managed-client MCP config.
- [ ] Disable stdio MCP by default outside explicit trusted mode.

### P1

- [ ] Add per-tool and per-server remote publication controls.
- [ ] Add result redaction before upstream send.
- [ ] Add config secret scanning and validation on save.
- [ ] Add per-server trust classification and review metadata.

### P2

- [ ] Introduce sandboxing for untrusted stdio MCP servers.
- [ ] Split execution capability from remote egress capability.
- [ ] Add richer audit events for high-risk tool invocations without logging raw secret values.

---

## Acceptance Criteria For A Safer Baseline

The implementation can be considered meaningfully safer when all of the following are true:

- Built-in shell execution is off by default.
- Interactive session tools are independently gated and off by default.
- `file_read` is deny-by-default outside managed workspace unless explicitly widened.
- Non-TLS upstream connections are rejected.
- Tokens are not sent in query strings in normal production deployment.
- Existing external MCP servers are not auto-published without explicit trust approval.
- Stdio MCP child processes do not receive broad inherited environment variables.
- Local config files do not store raw credentials.
- Tool results are filtered before remote egress.

---

## Suggested Implementation Order

1. Harden defaults in built-in tool policy.
2. Enforce secure transport.
3. Remove secrets from local config files.
4. Add per-server and per-tool publication governance.
5. Add result redaction and secret scanning.
6. Add sandboxing for high-risk external MCP servers.