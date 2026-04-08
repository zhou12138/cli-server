# Managed Client MCP-WS Threat Model

## 1. Scope

本文覆盖当前 `cli-server` 中 `managed-client-mcp-ws` 模式的真实安全边界，重点分析：

1. 当前实现已经具备哪些安全控制
2. 在这些控制存在的前提下，最现实的威胁是什么
3. 哪些风险已经从“协议层漏洞”转移为“本地工具面和运维配置风险”
4. 后续应优先推进哪些改造，才能把当前实现从“过渡可用”推进到“正式可防御”

本文不讨论抽象上的理想系统，而是以当前代码路径为准。

---

## 2. System Summary

当前 `managed-client-mcp-ws` 模型的基本流程如下：

1. Desktop client 获取 Bearer Token
2. Client 以 `wss` 主动连接远端 MCP Hub
3. WebSocket 握手使用 `Authorization: Bearer <token>`
4. 服务端发送 `session_opened`
5. Client 发送 `register(client_id, client_name)`
6. 服务端返回绑定上下文与当前签名信息
7. Client 发布本地工具列表 `update_tools`
8. 服务端下发带签名元数据的 `tool_call`
9. Client 校验请求并决定是否执行本地工具
10. Client 通过 `tool_result_chunk` 或 `tool_error` 返回结果

这个模式的本质不是“普通 API 客户端”，而是“远端可调度的本地执行节点”。
因此，核心风险不只是传输安全，而是本地能力是否被不当暴露、误用或滥用。

---

## 3. Assets At Risk

当前模式下，真正有价值的资产包括：

1. 本地工作区源码和文档
2. 用户目录下的敏感文件，如 `.env`、SSH key、浏览器状态、云凭据、token 缓存
3. 本地命令执行能力与交互式会话能力
4. 子进程可继承的环境变量和运行时秘密
5. 外部 MCP 服务器可访问的数据库、API 和内部系统
6. 用于建立 WebSocket 会话的访问令牌
7. 本地工具执行产生的 stdout、stderr 和文件内容

这些资产里，最危险的通常不是 token 本身，而是“远端拿到本地执行和本地读取能力以后可以访问到的数据”。

---

## 4. Trust Boundaries

当前实现中的关键 trust boundary 如下：

1. Remote MCP Hub 到本地 desktop node 的 WebSocket 边界
2. Desktop node 到 built-in tools 的执行边界
3. Desktop node 到外部 MCP server 进程或 HTTP 服务的边界
4. 本地配置文件到运行时进程的边界
5. 运行时到审计日志、状态面板、错误输出的边界
6. TLS 终止点到应用层消息签名验证之间的边界

当前最大的误区是把所有风险都理解成“网络 MITM”。
实际上，当前实现的高风险面已经更多集中在第 2、3、6 条边界上。

---

## 5. Implemented Security Controls

截至 2026-04-07，当前实现已经具备以下关键控制：

### 5.1 Transport Controls

1. 支持 `https://` 归一化为 `wss://`
2. 非 localhost 场景要求 TLS 证书校验与 hostname 校验
3. WebSocket 认证材料已从 query token 迁移到 `Authorization` header

### 5.2 Request Binding Controls

1. `register` 后会建立绑定上下文，包括：
	- `user_id`
	- `client_id`
	- `connection_id`
	- `session_id`
	- `server_key_id`
	- `server_time`
	- `server_public_key`（当前为过渡方案）
2. 每个 `tool_call` 都包含签名元数据：
	- `iat`
	- `exp`
	- `nonce`
	- `body_sha256`
	- `key_id`
	- `signature`
3. Client 在执行前校验：
	- `user_id`
	- `client_id`
	- `connection_id`
	- `session_id`
	- `key_id`
	- `iat/exp`
	- `nonce`
	- `body_sha256`
	- `signature`
4. Client 维护本连接级 replay cache，连接断开后会清空

### 5.3 Local Capability Controls

1. 内置三种权限档位：
	- `command-only`
	- `interactive-trusted`
	- `full-local-admin`
2. 不同档位影响：
	- 发布哪些工具
	- 是否允许外部 MCP tool publication
	- 结果是否完整回传
3. `shell_execute`、`file_read` 等内置工具已支持一定程度的策略约束

### 5.4 Governance Controls

1. `remote_configure_mcp_server` 默认不开启
2. 外部 MCP 工具发布与权限档位绑定
3. 工具调用与连接过程有基础审计记录

这些控制意味着：

1. 当前实现已经不再是“裸 WebSocket + token + 任意本地执行”
2. 协议层安全性较此前有明显提升
3. 但核心风险仍未消失，只是从“简单链路攻击”转移到了更复杂、更现实的本地能力与信任根问题上

---

## 6. Threat Reassessment

基于当前实现，威胁优先级应重新排序如下。

### 6.1 Highest Risk: Local Capability Exposure

当前最大的风险不是 WebSocket 协议，而是远端一旦成为“合法调用方”，本地工具面仍可能暴露过大。

#### Why It Matters

1. `shell_execute` 和 `session_*` 可直接把本地机器变成远程命令执行节点
2. `file_read` 在策略宽松时可读取高价值本地文件
3. `full-local-admin` 会把完整结果上送远端
4. 这类风险一旦触发，伤害通常是直接的数据外流，而不是仅限于协议破坏

#### Current Exposure

1. 默认 built-in policy 仍偏宽松
2. `shellExecute.enabled` 默认开启
3. `blockNetworkCommands` 默认关闭
4. `fileRead.allowedPaths` 为空时仍不是 deny-by-default
5. interactive session 工具仍与 shell execution 高度耦合
6. 结果回传前没有真正的 secret redaction / DLP

#### Risk Rating

- Confidentiality: Very High
- Integrity: High
- Availability: Medium

### 6.2 Highest Risk: External MCP Server Surface

外部 MCP server 是当前最容易被低估的攻击面。

#### Why It Matters

1. stdio MCP server 是本地子进程，不受 host built-in tool policy 的同等级约束
2. 外部 MCP server 可以直接读取绝对路径、环境变量、网络资源
3. HTTP MCP server 可能本身就是一个高权限出站代理
4. 一旦允许 `tools: ["*"]`，暴露面可能远大于本地内置工具

#### Current Exposure

1. `cwd` 不是沙箱
2. 现有 external MCP config 若已存在，仍可能被加载
3. 不存在 server provenance / attestation / binary integrity
4. 没有真正的 outbound egress policy
5. child process 继承环境变量仍是风险点

#### Risk Rating

- Confidentiality: Very High
- Integrity: Very High
- Availability: Medium

### 6.3 Medium-High Risk: Transitional Trust Anchor Model

当前 `tool_call.signature` 已经存在，但信任根仍是过渡方案。

#### What Is Good

1. 可以防公网 MITM
2. 可以防请求串包
3. 可以防跨连接误投递
4. 可以防重放
5. 可以防请求体被中间层随手改写

#### What Is Still Weak

1. `server_public_key` 仍通过当前 TLS 会话里的 `register` 动态下发
2. Client 信任的消息验签公钥，并不是预置的独立 trust anchor
3. 如果攻击者位于 TLS 终止后的内部代理层，或能控制参与 `register` 的中间层，就可能替换公钥与后续签名内容

#### Risk Rating

- Confidentiality: Medium
- Integrity: Medium to High
- Availability: Low

#### Security Assessment

这套方案足够作为过渡期的“可用安全方案”，但不能视为高保证正式方案。

### 6.4 Medium Risk: Missing Result Egress Filtering

当前入站请求校验已经加强，但出站结果治理仍较弱。

#### Why It Matters

1. 即使请求合法，工具结果仍可能包含 secrets
2. 一旦回传路径不做 DLP，远端就能稳定收集本地敏感数据
3. 权限 profile 只是在一部分模式下降低结果粒度，不等于真正的内容审查

#### Current Exposure

1. `command-only` 和 `interactive-trusted` 降低了结果外流面
2. `full-local-admin` 仍允许完整结果回传
3. `tool-defense` 目前仍是 noop，实现上没有真正的 response filtering

#### Risk Rating

- Confidentiality: High
- Integrity: Low
- Availability: Low

### 6.5 Medium Risk: Configuration Mistakes

当前还有一类很现实的风险不是被攻击，而是被错误配置。

#### Examples

1. 使用 `http://` / `ws://` 作为 base URL
2. 在生产环境启用 `full-local-admin`
3. 外部 MCP server 配置为 broad tool publication
4. 将 secrets 写入 child process args 或 env blocks

#### Risk Rating

- Confidentiality: Medium to High
- Integrity: Medium
- Availability: Medium

### 6.6 Lower Risk Than Before: Simple Public-Network MITM

这是当前最不应继续当作“头号威胁”的风险。

#### Why It Dropped

1. 已迁移到 `Authorization` header
2. 已启用 TLS 校验
3. 已有请求级绑定
4. 已有请求级签名
5. 已有 replay protection

#### Residual Risk

公网 MITM 不是消失了，而是已经从“高概率直接突破”降为“依赖 TLS 层或内部链路异常”的次一级风险。

---

## 7. What The Current Design Defends Well

当前设计在以下方面已经有较强防护：

1. Query token 泄漏风险明显下降
2. 非授权第三方很难直接伪造一个合法 `tool_call`
3. 同一请求被重复投递会被 replay cache 拦截
4. 请求体内容被改写会触发 `body_sha256` 校验失败
5. 不同用户、不同 client、不同连接之间的误投递会被绑定校验拦截

这些改造的意义是真实的，不应该低估。

---

## 8. What The Current Design Does Not Yet Defend Well

当前设计仍然不能很好防御以下场景：

1. 内部信任边界中的代理、中间层或服务节点篡改
2. 已被合法授权的远端通过高权限本地工具读取或导出敏感信息
3. 外部 MCP server 作为本地高权限扩展面带来的数据外流
4. 完整 tool result 中的 secrets 被稳定上送
5. 运维或配置错误导致的能力暴露

---

## 9. Current Overall Risk Profile

如果按当前实现进行重新评估，我会给出如下总体结论：

### 9.1 Public Network MITM

- Current Risk: Medium-Low
- Reason: TLS + header token + request binding + signature + replay cache

### 9.2 Internal Proxy / Trust-Boundary Tampering

- Current Risk: Medium
- Reason: trust anchor 仍是动态下发，尚未做到 client 预置信任

### 9.3 Local Data Egress Through Legitimate Tool Calls

- Current Risk: High
- Reason: built-in tools 和 external MCP 才是最强的数据访问面

### 9.4 Misconfiguration-Driven Exposure

- Current Risk: Medium-High
- Reason: 宽松默认值、生产态错误档位、缺少 deny-by-default

### 9.5 Final Summary

当前 `managed-client-mcp-ws` 的主要威胁，已经不再是“协议太弱”，而是：

1. 合法远端请求触达本地高权限工具面
2. 外部 MCP server 扩展面过大
3. trust anchor 仍是过渡设计
4. 出站结果缺少真正的内容治理

---

## 10. Priority Remediation Plan

如果只按优先级做最有价值的改造，建议顺序如下：

### P0

1. 把 built-in tools 默认策略改成接近 deny-by-default
2. 生产环境默认拒绝 `ws://` / `http://`
3. 收紧 `file_read` 默认允许路径
4. 把 `blockNetworkCommands` 默认改为开启

### P1

1. 把 `tool-defense` 从 noop 改成真实的 request / response 安全层
2. 为 `tool_result_chunk` 增加 secrets redaction / DLP
3. 把 interactive session 从 shell execution 中独立开关

### P2

1. 将 `register -> server_public_key` 过渡模型替换为 client 预置独立 trust anchor
2. 引入 `key_id + signed key manifest` 的正式轮换方案
3. 补服务端 replay ledger 或已签发请求登记

### P3

1. 对外部 MCP server 增加 provenance、sandbox、egress control
2. 进一步将“本地执行权限”和“远端结果回传权限”拆分
3. 为高风险工具增加审批或额外授权

---

## 11. Final Statement

当前 `managed-client-mcp-ws` 已经从“单纯靠 TLS 和 token 的远端本地执行通道”演进为“具备请求级身份绑定、过期控制、重放保护和消息签名的远端本地执行通道”。

这是明显的安全进步。

但在当前实现下，最需要继续关注的已经不是简单 MITM，而是：

1. 本地高权限工具面是否过宽
2. 外部 MCP server 是否带来额外高权限扩展面
3. trust anchor 是否仍停留在过渡模型
4. 工具结果是否能无过滤地离开本机

只有把这四类风险继续压下去，当前模式才算进入更可辩护的生产安全状态。

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



第 1 阶段

禁止 tools: ["*"]
增加 publishedRemotely
增加 trustLevel
stdio 默认禁用
external MCP 默认 status-only
第 2 阶段

增加 tool 级 allowlist / risk level
外部 server 独立审计
env 白名单注入
禁止高风险 server 的远端全文结果回传
第 3 阶段

stdio 沙箱
网络出站控制
provenance 和审批流