# LandGod Architecture — AI Agent Scheduling Platform

## What is LandGod

LandGod is an **AI Agent resource scheduling platform** using a Gateway-Worker architecture:

```
AI Agent (brain)
  │
  ▼ HTTP API (:8081)
Gateway (scheduling plane)
  │  ┌─ Label routing    ┌─ Async tasks
  │  ├─ Resource aware   ├─ Task queue
  │  ├─ Batch dispatch   └─ Centralized audit
  │
  ▼ WebSocket (:8080) + Ed25519 signing
Worker × N (tools on remote devices)
```

**One sentence:** If Kubernetes schedules Pods, LandGod schedules Tools — the smallest schedulable unit in the AI era.

---

## Architecture Comparison

### Three Approaches to Multi-Device AI

| | Agent per Device | Agent + SSH | LandGod |
|---|---|---|---|
| **LLM cost** | N × cost | 1 × cost | 1 × cost |
| **Setup per device** | Heavy (agent + LLM) | Medium (SSH key) | Light (npm install) |
| **Firewall** | ✅ | ❌ Need SSH port | ✅ Outbound WebSocket |
| **Cross-border** | ❌ | ⚠️ Unreliable | ✅ Cloudflare Tunnel |
| **Persistent connection** | ❌ | ❌ | ✅ WebSocket |
| **Centralized control** | ❌ | ⚠️ | ✅ Gateway API |
| **Capability routing** | ❌ | ❌ | ✅ Labels |
| **Async/Queue** | ❌ | ❌ | ✅ |
| **Resource awareness** | ❌ | ❌ | ✅ |
| **External tools (MCP)** | ❌ | ❌ | ✅ |
| **Security** | ⚠️ Keys everywhere | ⚠️ SSH keys | ✅ Token + Ed25519 |

### LandGod vs Traditional Ops Tools

| | LandGod | Ansible | Puppet |
|---|---|---|---|
| **Input** | Natural language / HTTP | YAML playbook | DSL manifest |
| **Learning curve** | ⭐ Zero | ⭐⭐⭐ Medium | ⭐⭐⭐⭐ High |
| **Flexibility** | ⭐⭐⭐⭐⭐ Any ad-hoc task | ⭐⭐⭐ Pre-defined | ⭐⭐ Declarative |
| **Scale** | 3-30 devices | 10-10000 | 10-10000 |
| **Latency** | ⭐⭐⭐⭐ WebSocket instant | ⭐⭐ SSH | ⭐⭐ Pull-based |
| **AI native** | ⭐⭐⭐⭐⭐ | ⭐ Needs wrapper | ⭐ Needs wrapper |
| **Scheduling** | Labels + resources + queue | Inventory groups | Node classification |
| **MCP support** | ✅ Native | ❌ | ❌ |

### LandGod vs Multi-Agent

| | LandGod (Orchestrator-Worker) | Multi-Agent (distributed AI) |
|---|---|---|
| **Worker intelligence** | ❌ Pure tools | ✅ Each has AI brain |
| **Cost** | ⭐⭐⭐⭐⭐ Minimal | ⭐⭐ N × tokens |
| **Parallel** | ✅ batch_tool_call | ✅ True parallel thinking |
| **Autonomy** | ❌ Waits for commands | ✅ Independent decisions |
| **Scheduling** | ✅ Labels + resources + queue | ⚠️ Manual coordination |
| **Best for** | Executing clear tasks at scale | Tasks needing independent thought |

---

## Scheduling Capabilities (v0.1.1)

### 1. Label-Based Routing

Workers declare capabilities. Agent requests by capability, not hardcoded name:

```
Agent: "Run ML training on a GPU machine"
  → Gateway checks labels: {"gpu": true}
  → Routes to Worker-GPU automatically
```

### 2. Resource Awareness

Workers report CPU/memory/load every 60 seconds:

```
GET /clients → {
  "Worker-A": { cpuCount: 8, freeMemoryMB: 16384, loadAvg1m: 0.5 },
  "Worker-B": { cpuCount: 2, freeMemoryMB: 4096, loadAvg1m: 2.1 }
}
→ Agent picks Worker-A (lower load, more memory)
```

### 3. Parallel Batch Dispatch

Execute on multiple workers simultaneously:

```
POST /batch_tool_call → [Worker-US, Worker-JP, Worker-CN]
  All run curl in parallel → results in ~3s, not ~9s
```

### 4. Async Tasks

Long-running tasks return immediately:

```
POST /tool_call?async=true → {"taskId": "task-xxx", "status": "pending"}
  ... 2 hours later ...
GET /tasks/task-xxx → {"status": "completed", "result": {...}}
```

### 5. Task Queue

Offline workers receive tasks when they reconnect:

```
POST /tool_call?queue=true (Worker offline)
  → {"taskId": "task-xxx", "status": "queued"}
Worker comes online → auto-executes → result in /tasks/task-xxx
```

### 6. Centralized Audit

View audit logs from all workers in one place:

```
GET /audit → aggregated logs from all connected workers
```

---

## Six Dimensions of Extension

| Dimension | Example | How |
|-----------|---------|-----|
| 🧠 **Compute** | GPU worker runs ML training | Label routing: `{"gpu":true}` |
| 🌐 **Geography** | Test latency from US/JP/CN | batch_tool_call to 3 regions |
| 🖥️ **Platform** | Build .NET on Windows, iOS on Mac | Label: `{"platform":"windows"}` |
| 🔒 **Network** | Access internal DB behind firewall | Worker connects outbound |
| 🔀 **Parallelism** | Scan 50 sites across 10 workers | batch_tool_call with split |
| 🧰 **Capabilities** | Playwright browser, PostgreSQL MCP | MCP servers per worker |

---

## Strengths

- **Zero learning curve** — Any AI agent with HTTP can use it
- **AI native** — Sidecar gateway, fully decoupled
- **MCP ecosystem** — Remote Playwright, databases, any MCP server
- **Security** — Ed25519 signing + token auth + command allowlist + audit
- **Cross-platform** — Linux, macOS, Windows, any cloud
- **Smart scheduling** — Labels, resources, async, queue, batch

## Limitations

- **Single-brain bottleneck** — One agent orchestrates all (mitigated by batch)
- **Network dependency** — Workers must reach Gateway (mitigated by Cloudflare Tunnel)
- **Not for 100+ devices** — Use Ansible/K8s for large scale
- **Workers have no intelligence** — Can't make decisions independently

---

## Target Users

| User | Pain Point | LandGod Value | Fit |
|------|-----------|---------------|-----|
| Solo dev (3-10 servers) | Repetitive SSH | One command manages all | ⭐⭐⭐⭐⭐ |
| Small team (no dedicated ops) | No ops engineer | AI is the ops | ⭐⭐⭐⭐⭐ |
| AI app developer | Need Agent + Tool | Native MCP integration | ⭐⭐⭐⭐⭐ |
| HomeLab enthusiast | Mixed devices | Single gateway | ⭐⭐⭐⭐ |
| Enterprise ops (100+ devices) | Already have Ansible | Overkill | ⭐⭐ |

---

## Recommended Hybrid Architecture

```
Human
 │
 ├→ Main Agent (brain) ——— decisions, complex tasks
 │   │
 │   ├→ LandGod Gateway ──→ Worker × N
 │   │   Cheap, fast, obedient: run commands, install, monitor
 │   │   Labels + resources → smart routing
 │   │   Async + queue → long/offline tasks
 │   │
 │   └→ Sub-Agents (specialized)
 │       24/7 patrol, security scanning, independent judgment
 │
 └→ Other Agents (on demand) ——— code review, research
```

**Principle:** Use LandGod Workers for execution. Use Agents for thinking.
