# Managed Client Security Review

Date: 2026-04-07

## Scope

本 review 聚焦当前 `cli-server` 中 `managed-client-mcp-ws` 实现，按以下维度检查当前状态：

1. 认证
2. 签名
3. 防重放
4. 审计
5. 权限分级
6. 结果治理
7. 如何避免把“受信任远端”扩大成“无限制整机暴露”

本文不是抽象设计建议，而是基于当前代码实现的实现级 review。

---

## Executive Summary

当前实现的结论很明确：

1. 认证、签名、防重放这条链路已经具备基本可用性，方向是正确的
2. 当前最明显的短板不是 WebSocket 协议层，而是结果治理、审计内容控制和外部 MCP 扩展面治理
3. “受信任远端可执行本机”这个前提本身没有问题，但当前实现还缺少足够强的工程化护栏，来防止能力从“受控远程执行”滑向“过宽整机暴露”

---

## Findings

### 1. High: 结果治理层实际上未生效

当前运行时会调用请求与响应检查接口，但真正使用的是一个 noop defense layer。

证据：

1. `inspectToolCall` 默认 `allowed: true`，见 `src/main/managed-client/tool-defense.ts`
2. `inspectToolResponse` 默认 `allowed: true` 且直接返回 `context.responseText`，见 `src/main/managed-client/tool-defense.ts`
3. `createManagedClientDefenseLayer(...)` 直接返回 `NoopManagedClientDefenseLayer`，见 `src/main/managed-client/tool-defense.ts`
4. 运行时虽然调用了 request/response inspection，但没有真实策略生效，见 `src/main/managed-client/mcp-ws-runtime.ts`

影响：

1. 入站 tool call 参数没有额外内容级审查
2. 出站 tool result 没有 secret redaction / DLP
3. `full-local-admin` 模式下结果治理几乎等于无

结论：

当前“结果治理”在架构上存在，在实现上基本未落地。

### 2. High: 审计日志正在记录高敏感原始内容

当前审计不仅记录事件，还会记录请求参数、执行结果和错误文本。

证据：

1. `tool_call received` 会把参数写入审计，见 `src/main/managed-client/mcp-ws-runtime.ts`
2. `tool_call failed` / `tool_call completed` / `tool_call response blocked` 会把 `result` 写入审计，见 `src/main/managed-client/mcp-ws-runtime.ts`
3. `appendAuditEntry` 会把内容直接写入 `audit.jsonl`，见 `src/main/managed-client/mcp-ws-runtime.ts` 和 `src/main/audit/logger.ts`
4. 审计系统支持对 `stdout` / `stderr` 搜索和导出，见 `src/main/audit/logger.ts`

影响：

1. 即使远端结果治理未来补上，本地审计仍可能保存敏感原文
2. 审计日志自身变成高价值数据集
3. 本地留痕周期可能远超远端结果保留周期

结论：

当前审计更像是完整转储，不像安全审计。对于高权限本地执行节点，这个差异很关键。

### 3. High: 认证 token 仍存在明文落盘风险

虽然连接时已经改为走 `Authorization` header，而不是 query token，但 token at rest 仍偏弱。

证据：

1. managed client 配置模型包含 `token` 字段，见 `src/main/managed-client/config.ts`
2. `saveManagedClientFileConfig(...)` 会把配置整体写入 `managed-client.config.json`，见 `src/main/managed-client/config.ts`

影响：

1. 认证凭据可能落在工作目录明文文件中
2. 文件复制、误提交、备份和本地恶意读取都会扩大认证面

结论：

传输中的 token 暴露面已经下降，但存储中的 token 暴露面还没有被同等级治理。

### 4. Medium: 权限分级框架正确，但默认边界仍偏宽

权限模型本身是对的，默认 profile 也是 `command-only`，这一点合理。但默认允许的执行面仍然不小。

证据：

1. 默认 permission profile 是 `command-only`，见 `src/main/builtin-tools/types.ts`
2. `command-only` 默认仍开启 `shellExecute.enabled`
3. `allowedExecutableNames` 默认空
4. `allowedWorkingDirectories` 默认空
5. `interactive-trusted` 同样默认没有 allowlist

影响：

1. 边界更多依赖“远端身份可信”而不是“本地能力最小化”
2. 如果未来远端不是单一受信任管理员，而是更大的控制平面，暴露面会迅速放大

结论：

权限分级已具备基础框架，但默认最小权限化还不够彻底。

### 5. Medium: 外部 MCP Server 是最强扩展攻击面，当前治理仍弱

当前 external MCP 的准入主要靠 permission profile，不是真正的隔离模型。

证据：

1. external MCP 接入按 permission profile 决策，见 `src/main/managed-client/mcp-tool-registry.ts`
2. 工具列表允许 `"*"`，见 `src/main/managed-client/mcp-tool-registry.ts`
3. `stdio` transport 直接使用 `env: serverConfig.env` 启动子进程，见 `src/main/managed-client/mcp-tool-registry.ts`

影响：

1. 外部 server 可获得远强于 built-in tool policy 的实际能力
2. 子进程环境变量和本地文件访问面可能比预期更大
3. `cwd` 约束只能限制默认工作目录，不构成真正沙箱

结论：

如果要控制“整机暴露”，external MCP 是当前必须重点治理的边界。

### 6. Medium: 认证、签名、防重放链路已经具备基本能力，但仍是过渡模型

这一块当前不是主要短板，但需要正确理解边界。

证据：

1. `register` 之后会绑定 `user_id/client_id/connection_id/session_id/server_key_id/server_public_key`
2. 每个 `tool_call` 会校验 binding、时效、nonce、body hash 和 signature
3. replay protection 依赖本连接级 replay cache

影响：

1. 能有效防止简单公网 MITM、串会话和重复投递
2. 但 trust anchor 仍是动态下发，尚未升级为独立预置信任
3. replay ledger 仍主要在 client 本地，而不是更强的服务端全局签发账本

结论：

这条链已经从“脆弱”进入“可用”，但还没有进入“正式高保证”。

---

## By Area

### Authentication

当前状态：

1. WebSocket 握手已使用 `Authorization: Bearer <token>`
2. 非 localhost 场景要求 `wss` 与 TLS 校验
3. token 仍可能以明文配置形式落盘

评估：

1. 传输态认证明显优于之前
2. 存储态认证仍然偏弱

### Signing

当前状态：

1. `tool_call` 已包含签名元数据
2. Client 已执行签名验证与绑定验证

评估：

1. 请求完整性和来源校验已有基础
2. trust anchor 仍属过渡方案

### Replay Protection

当前状态：

1. 校验 `iat/exp`
2. 校验 `session_id + nonce`
3. 校验 `body_sha256`
4. 重放命中则拒绝执行

评估：

1. 当前能有效防止同会话内的重复投递
2. 仍缺更强的服务端侧 replay ledger

### Audit

当前状态：

1. 审计覆盖面广
2. 审计原文保留过多

评估：

1. 适合排障
2. 不适合高敏环境的长期安全审计

### Permission Segmentation

当前状态：

1. 有 `command-only`、`interactive-trusted`、`full-local-admin`
2. 不同档位影响工具发布和结果模式

评估：

1. 框架正确
2. 默认 allowlist 过空，更多是“未限制”而不是“已最小化”

### Result Governance

当前状态：

1. `command-only` / `interactive-trusted` 会降低回传粒度
2. `tool-defense` 还没做真实 response filtering

评估：

1. 结果治理是当前最主要缺口之一

---

## Overall Judgment

如果从“认证、签名、防重放、审计、权限分级、结果治理，以及避免把受信任扩大成无限制整机暴露”这几个维度做综合判断，当前实现可以概括成：

1. 协议层已经明显强于早期版本
2. 当前主要风险已经不再是简单链路攻击
3. 当前主要风险是：
   - 本地高权限工具面
   - 外部 MCP server 扩展面
   - 审计中的原始敏感数据保留
   - 出站结果缺少真实治理

---

## Recommended Priority

### P0

1. 把 `tool-defense` 从 noop 改成真实的 request/response 安全层
2. 把审计日志从原文记录改成摘要记录
3. 禁止 token 以明文形式落盘，改为系统凭据存储或仅内存态保存

### P1

1. 收紧 built-in tools 默认 allowlist
2. 让 interactive session 与 shell execution 分开治理
3. 对外部 MCP server 增加更严格的默认接入策略

### P2

1. 升级到独立 trust anchor
2. 增加服务端 replay ledger
3. 为高风险工具增加更强审批或二次授权

---

## Final Statement

当前实现已经证明你在协议安全上是认真做过工程化投入的，这一点成立。

但如果你真正要把这个模式定义为“受信任远端执行本机”，那么后续最应该优先补的是治理层，而不是继续把主要精力放在 `cwd` 这类弱边界上。

更准确地说，当前最关键的不是“能不能执行”，而是：

1. 执行后哪些数据能出去
2. 这些数据会不会在本机被长期保存
3. 哪些外部扩展面实际上绕过了你的本地边界

这三件事决定了它最终会是“受控远程执行节点”，还是“默认高权限整机暴露节点”。