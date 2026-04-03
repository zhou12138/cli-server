# managed-client-mcp-ws 抗中间人攻击设计文档

## 1. 文档目的

本文面向当前 `managed-client-mcp-ws` 模型，回答两个问题：

1. 在现有 `Bearer Token + TLS + WebSocket tool_call` 架构下，如何系统性降低中间人攻击风险
2. 客户端和服务端分别需要承担哪些职责，协议需要增加哪些字段和校验

本文不是泛泛讨论 TLS 常识，而是给出一份可落地的 client/server 设计，便于后续协议改造、代码实现和安全验收。

## 2. 当前模型与已知现状

当前 `managed-client-mcp-ws` 模型大致如下：

1. Desktop client 通过浏览器登录或静态 Token 获取访问凭证
2. Client 主动向服务端发起 `wss` WebSocket 连接
3. 服务端发送 `session_opened`
4. Client 发送 `register`
5. Client 发送 `update_tools`
6. 服务端发送 `tool_call`
7. Client 执行本地工具并通过 `tool_result_chunk` / `tool_error` 返回结果

当前实现里，已经具备以下基础能力：

1. 非 localhost 场景强制要求 `https` / `wss`
2. TLS 默认启用服务端证书校验与 hostname 校验
3. 客户端在握手阶段能拿到 `connection_id`
4. WebSocket 认证已从 URL query 迁移到握手头 `Authorization: Bearer <token>`
5. `register` 响应已返回并锁定 `user_id/client_id/connection_id/session_id/server_key_id/server_time`
6. 当前实现额外通过 `server_public_key` 向 client 下发过渡期验签公钥
7. 每个 `tool_call` 已包含 `meta(iat/exp/nonce/body_sha256/key_id/signature)` 并在 client 执行前完成校验
8. Client 已维护本连接级 replay cache，并在连接断开时清空

但如果讨论“防止中间人攻击”，当前能力还不够完整，原因在于：

1. TLS 只能保护链路，不自动保护业务消息的归属关系
2. Bearer Token 一旦被窃取，本身不具备持有者证明能力
3. 当前实现的验签公钥仍通过已验证 TLS 连接上的 `register` 响应下发，属于过渡信任模型
4. 仅靠连接级绑定和消息签名，仍不能解决 token 被窃取后的持有者证明问题

因此，抗中间人设计必须拆成两层：

1. 传输层防护，阻断网络路径上的传统 MITM
2. 请求层绑定与签名，阻断连接内串改、重放、错误路由和部分受信边界内 MITM

## 3. 威胁模型

本文重点覆盖以下攻击面：

1. 攻击者位于 client 与服务端之间，试图解密、篡改或注入 `tool_call`
2. 攻击者通过错误代理、错误路由、消息总线串包，把别的用户请求送到当前 client
3. 攻击者重放旧的 `tool_call`，诱导 client 重复执行本地动作
4. 攻击者窃取 Bearer Token 后建立看似合法的新连接
5. TLS 在外层终止后，内网链路上的组件继续篡改消息

本文不试图解决以下问题：

1. 本地机器已被攻破
2. 服务端控制平面本身已被攻破并能合法地下发恶意请求
3. `full-local-admin` 权限模式天然带来的高本地能力面

## 4. 安全目标

针对当前模型，抗 MITM 的目标应明确为：

1. Client 必须能够确认对端确实是受信任服务端
2. Client 必须能够确认一条 `tool_call` 确实属于当前用户、当前 client、当前连接
3. Client 必须能够拒绝过期请求、重放请求和被篡改请求
4. 服务端必须能够限制 token 泄漏后的复用窗口
5. 整个链路中的日志、代理和中间层不应拿到可长期复用的认证材料

## 5. 总体设计结论

在当前 `managed-client-mcp-ws` 模型下，防止中间人攻击的建议方案不是单点修复，而是以下五层同时成立：

1. `wss + 严格证书校验 + 可选证书钉扎`，防网络 MITM
2. 去掉 query-string token，改为握手头或首帧认证，防日志与代理泄漏
3. `register` 返回并锁定 `user_id/client_id/connection_id/session_id`，防串会话
4. 每个 `tool_call` 增加 `iat/exp/nonce/body_sha256/signature/key_id`，防篡改与重放
5. Client 建立本地 replay cache 和严格拒绝策略，任何字段缺失或校验失败都不执行工具

截至 2026-04-07，前四层已经在当前代码路径中落地，第五层也已实现基础版本：

1. Desktop client 通过 WebSocket 握手头发送 `Authorization`
2. Societas `mcphub` 服务端在 `register` 后返回绑定字段和当前签名公钥
3. 服务端下发的 `tool_call` 已包含 `meta + body_sha256 + signature`
4. Desktop client 在执行本地工具前会做归属、时效、重放、哈希和签名校验
5. 当前剩余主要风险是公钥仍通过当前 TLS 会话动态分发，尚未做内置公钥或 key manifest 钉扎

如果只能分阶段推进，则优先级如下：

1. 第一阶段：强制 TLS、去掉 query token、补齐 `user_id/client_id/connection_id`
2. 第二阶段：补 `iat/exp/nonce` 和 replay cache
3. 第三阶段：补请求签名和服务端签名密钥轮换
4. 第四阶段：按部署等级引入 mTLS、证书钉扎或 PoP Token

## 6. 协议设计

### 6.1 传输层要求

生产环境协议要求如下：

1. 非 loopback 地址只允许 `https` / `wss`
2. 禁止从 `wss` 降级到 `ws`
3. Client 必须启用 `rejectUnauthorized: true`
4. Client 必须基于目标 hostname 做 SNI 与 hostname 校验
5. 禁止使用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 之类的绕过方式
6. 如部署环境允许，增加 SPKI pin 或私有 CA pin 作为增强项

推荐规则：

1. 开发态仅允许 `localhost` 放宽到 loopback 特例
2. 任何非 loopback 域名，只要证书不匹配，直接拒绝连接

### 6.2 认证材料传递要求

历史实现曾将 token 放在 `access_token` query 参数中，这不利于抗 MITM，原因如下：

1. 反向代理日志可能记录完整 URL
2. 监控、审计和错误追踪可能误收集 query
3. 某些中间层会把 URL 作为高频可观测对象保留

设计要求：

1. 优先使用 `Authorization: Bearer <token>` 作为 WebSocket 握手头
2. 如果基础设施不支持自定义握手头，则改为 WebSocket 建立后立刻发送一次性 `authenticate` 首帧
3. 无论采用哪种方式，服务端都不得在日志中落明文 token
4. token 必须是短期有效，且仅用于 desktop session 建立

### 6.3 会话绑定字段

在 `register` 成功后，服务端必须返回以下字段：

1. `user_id`
2. `client_id`
3. `connection_id`
4. `session_id`
5. `server_key_id`
6. `server_time`
7. `server_public_key`，用于过渡期 client 验签

推荐响应示例：

```json
{
  "type": "res",
  "id": "req-register-1",
  "ok": true,
  "payload": {
    "user_id": "user-456",
    "client_id": "client-123",
    "connection_id": "conn-abc",
    "session_id": "sess-001",
    "server_key_id": "sig-key-2026-04",
    "server_time": "2026-04-03T08:30:00Z",
    "server_public_key": "-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEA...\\n-----END PUBLIC KEY-----"
  }
}
```

Client 必须把这些值保存为当前连接上下文，不允许跨连接复用。
其中 `server_public_key` 属于当前实现的过渡方案，后续更推荐切换为内置公钥、受控 key manifest 或公钥指纹钉扎。

### 6.4 tool_call 信封设计

服务端下发 `tool_call` 时，不应只发送业务参数，而应发送完整信封：

```json
{
  "type": "req",
  "id": "tool-call-001",
  "method": "tool_call",
  "params": {
    "meta": {
      "schema_version": "2026-04-01",
      "request_id": "tool-call-001",
      "session_id": "sess-001",
      "connection_id": "conn-abc",
      "user_id": "user-456",
      "client_id": "client-123",
      "iat": "2026-04-03T08:30:05Z",
      "exp": "2026-04-03T08:30:35Z",
      "nonce": "9d871f2e-5d31-4381-8d38-6b3d8c8f24c3",
      "body_sha256": "base64url-sha256-of-canonical-body",
      "key_id": "sig-key-2026-04",
      "signature": "base64url-signature"
    },
    "tool_name": "session_create",
    "arguments": {
      "command": "whoami"
    }
  }
}
```

字段语义如下：

1. `session_id` 用于标识当前认证会话
2. `connection_id` 用于标识当前 WebSocket 连接
3. `user_id` / `client_id` 用于标识归属
4. `iat` / `exp` 用于限制请求时效
5. `nonce` 用于单次请求唯一性
6. `body_sha256` 用于防止 `tool_name` 或 `arguments` 被中间层篡改
7. `key_id` 指定服务端用于签名的密钥版本
8. `signature` 用于让 client 验证请求来源与完整性

### 6.5 签名对象定义

为避免两端 canonicalization 不一致，签名对象必须固定。推荐签名输入为以下 JSON 结构的 canonical form：

```json
{
  "schema_version": "2026-04-01",
  "request_id": "tool-call-001",
  "session_id": "sess-001",
  "connection_id": "conn-abc",
  "user_id": "user-456",
  "client_id": "client-123",
  "iat": "2026-04-03T08:30:05Z",
  "exp": "2026-04-03T08:30:35Z",
  "nonce": "9d871f2e-5d31-4381-8d38-6b3d8c8f24c3",
  "tool_name": "session_create",
  "arguments": {
    "command": "whoami"
  }
}
```

签名算法建议：

1. 首选 `Ed25519`
2. 备选 `ES256`
3. 不建议自行拼接字符串后做 HMAC，除非 client 与 server 确实共享会话级对称密钥，并且密钥分发有清晰设计

## 7. Client 设计

### 7.1 Client 安全职责

Client 不是被动执行器，而是本地最后一道安全边界。Client 必须承担以下职责：

1. 验证 TLS 对端
2. 保存当前连接上下文
3. 验证每个 `tool_call` 的归属、时效、唯一性和签名
4. 对校验失败请求直接拒绝，不执行本地工具
5. 记录审计日志，但不能把敏感 token 打进日志

### 7.2 Client 状态机

推荐 client 状态如下：

1. `disconnected`
2. `tls_connected`
3. `session_opened`
4. `registered`
5. `ready`
6. `closing`

只有进入 `ready` 后，才允许处理 `tool_call`。

Client 必须在 `registered` 阶段保存：

1. `expectedUserId`
2. `expectedClientId`
3. `expectedConnectionId`
4. `expectedSessionId`
5. `expectedServerKeyId`
6. `expectedServerPublicKeyPem`
7. `serverClockOffsetMs`

### 7.3 Client 校验顺序

Client 收到 `tool_call` 后，必须按固定顺序校验：

1. `tool_name` 是否存在
2. `meta` 是否完整存在
3. 当前连接上下文是否已经建立完成
4. `user_id` 是否等于 `expectedUserId`
5. `client_id` 是否等于 `expectedClientId`
6. `connection_id` 是否等于 `expectedConnectionId`
7. `session_id` 是否等于 `expectedSessionId`
8. `key_id` 是否是当前允许的服务端签名密钥
9. `iat` / `exp` 是否在允许的时钟偏移窗口内
10. `nonce` 是否已在 replay cache 中出现过
11. `body_sha256` 是否与实际 `tool_name + arguments` 匹配
12. `signature` 是否校验通过

任一失败，必须终止执行，并返回结构化错误。

### 7.4 Client replay cache

为防止重放，client 必须维护本连接级 replay cache：

1. key 为 `session_id + nonce`
2. TTL 至少覆盖 `exp` 窗口，建议 5 到 10 分钟
3. 连接断开后立即清空旧连接缓存
4. 若发现重复 nonce，直接返回 `replay_detected`

当前实现中，replay cache 会记录到该请求 `exp` 为止，并额外容忍一个较小的时钟偏移窗口；连接断开后会立即清空。

### 7.5 Client 密钥信任模型

Client 验证 `tool_call.signature` 时，需要一个可信公钥来源。推荐按以下优先级实现：

1. 最佳方案：桌面应用内置服务端签名公钥或其指纹，并支持 `key_id` 轮换
2. 次优方案：桌面应用内置受信任 CA 或租户级 key manifest，并通过受控更新分发
3. 过渡方案：在已验证 TLS 连接上获取公钥，但仅能抵御网络 MITM，无法完全抵御 TLS 终止后的内部中间层篡改

如果目标只是先阻断网络 MITM，第三种可作为过渡；如果目标包含“防止受信边界内错误代理篡改消息”，则必须采用第一或第二种。

当前实现采用第三种过渡方案：Societas 服务端在 `register` 响应里返回 `server_public_key`，desktop client 在已验证 TLS 连接上缓存该公钥并对后续 `tool_call` 验签。

### 7.6 Client 错误码

建议固定错误码如下：

1. `unbound_session`
2. `missing_binding`
3. `user_mismatch`
4. `client_mismatch`
5. `connection_mismatch`
6. `session_mismatch`
7. `stale_request`
8. `replay_detected`
9. `body_hash_mismatch`
10. `invalid_signature`
11. `invalid_server_key`

推荐错误响应示例：

```json
{
  "type": "event",
  "event": "tool_error",
  "payload": {
    "request_id": "tool-call-001",
    "code": "invalid_signature",
    "message": "tool_call signature verification failed",
    "connection_id": "conn-abc"
  }
}
```

### 7.7 Client 审计要求

Client audit log 至少要记录：

1. 当前 `connection_id`
2. 当前 `session_id`
3. 当前 `user_id`
4. 当前 `client_id`
5. 被拒绝请求的 `request_id`
6. `tool_name`
7. 拒绝原因错误码

Client audit log 不应记录：

1. Bearer Token 明文
2. 原始签名密钥材料
3. 完整未脱敏的高风险工具参数

## 8. Server 设计

### 8.1 Server 安全职责

服务端需要承担的职责不是“把请求发给 client”这么简单，而是：

1. 为每条连接建立可信认证上下文
2. 为每个 `tool_call` 注入完整归属信息
3. 为每个 `tool_call` 生成防重放元数据和签名
4. 控制 token 生命周期与签名密钥轮换
5. 避免任何中间层拿到可长期复用的认证材料

### 8.2 Server 会话建立

服务端在 WebSocket 握手成功后，必须立刻建立不可变的连接上下文：

1. `authenticated_user_id`
2. `authenticated_client_id`
3. `connection_id`
4. `session_id`
5. `issued_at`
6. `auth_strength`
7. `signing_key_id`

这些字段必须来源于统一的认证链路，不能由业务层任意传入。

### 8.3 Server tool_call 构造规则

服务端在发送 `tool_call` 前必须做到：

1. 从连接上下文中读取 `user_id/client_id/connection_id/session_id`
2. 生成新的 `request_id`
3. 生成新的 `nonce`
4. 设置较短的 `exp`，建议 15 到 30 秒
5. 计算业务体 canonical form 的摘要
6. 使用当前活动签名私钥生成 `signature`

明确禁止：

1. 业务调用方自行填 `user_id/client_id/connection_id`
2. 下游服务在离开认证边界后再拼装签名
3. 使用无限期有效的 `tool_call`
4. 对同一 `request_id` 重复发送不同业务体

### 8.4 Server 密钥管理

服务端需要独立的消息签名密钥，而不是直接复用 TLS 证书私钥。建议如下：

1. 签名密钥单独托管在 KMS/HSM 或至少受限密钥存储中
2. 每个环境使用独立 `key_id`
3. 支持新旧 key 短期并行，便于 client 平滑轮换
4. 密钥轮换周期建议按月或按季度
5. 签名失败时不得降级为“无签名照常下发”

### 8.5 Server 防重放设计

虽然 client 会做 replay cache，但服务端也应做最小防重放控制：

1. `request_id` 全局唯一
2. `nonce` 单次唯一
3. 已发送但未过期的 `request_id` 不允许重新签发不同内容
4. 对超时未执行的请求可显式标记废弃

### 8.6 Server 日志与代理要求

服务端与网关必须遵守以下要求：

1. 任何访问日志不得记录 token query 或认证头明文
2. 若仍处于过渡期使用 query token，网关必须显式 scrub
3. 内部反向代理到 WebSocket Hub 的链路建议继续保持 TLS
4. 如存在多跳代理，至少在 trust boundary 之间使用 mTLS

## 9. Client 与 Server 交互流程

推荐交互顺序如下：

1. Client 以 `wss` 建立连接，并验证证书
2. 服务端发送 `session_opened(connection_id)`
3. Client 发送 `register(client_id, client_name)`
4. Server 校验 token，并返回 `user_id/client_id/connection_id/session_id/server_key_id/server_time/server_public_key`
5. Client 保存连接上下文，并切换到 `ready`
6. Server 下发带 `meta + signature` 的 `tool_call`
7. Client 校验归属、时效、nonce、hash、signature
8. 仅在全部通过后执行工具
9. Client 返回 `tool_result_chunk` 或 `tool_error`

第 7 步是关键边界。只要任一项失败，client 就必须视为潜在 MITM、串包或重放，而不是“先执行再说”。

## 10. 分阶段落地建议

### 当前实现状态

截至 2026-04-07，当前代码已完成以下落地：

1. [x] 握手认证已从 query token 切换到 `Authorization` header
2. [x] `register` 已返回 `user_id/client_id/connection_id/session_id/server_key_id/server_time/server_public_key`
3. [x] `tool_call` 已增加 `iat/exp/nonce/body_sha256/signature/key_id`
4. [x] Client 已实现请求级校验和 replay cache
5. [ ] 服务端签名公钥仍为过渡期动态分发，尚未升级到内置公钥或 key manifest
6. [ ] 服务端侧尚未实现独立的重放账本或已发送请求登记表

### 阶段一：最小可用抗 MITM 基线

目标：先把最明显的 MITM 与串会话风险降下来。

服务端改造：

1. 生产环境仅允许 `https` / `wss`
2. `register` 返回 `user_id/client_id/connection_id/session_id`
3. 每个 `tool_call` 都带 `user_id/client_id/connection_id/session_id`
4. token 从 query 迁移到 header 或首帧认证

当前状态：已落地。

客户端改造：

1. 严格拒绝证书错误和 hostname 不匹配
2. 保存完整连接上下文
3. 缺字段或归属不匹配一律拒绝

当前状态：已落地。

### 阶段二：防重放

服务端改造：

1. `tool_call` 增加 `iat/exp/nonce`
2. 请求过期窗口收紧到 15 到 30 秒

当前状态：已落地，当前默认 TTL 为 30 秒。

客户端改造：

1. 增加本地时钟偏移处理
2. 增加 replay cache
3. 对过期和重复 nonce 的请求一律拒绝

当前状态：已落地。

### 阶段三：防篡改

服务端改造：

1. 引入签名私钥与 `key_id`
2. 对 canonical request 进行签名

当前状态：已落地，当前使用 `Ed25519`。

客户端改造：

1. 内置或受控分发服务端公钥
2. 校验 `body_sha256` 和 `signature`
3. 对 `invalid_signature` 做高优先级审计

当前状态：`body_sha256` 与 `signature` 校验已落地；公钥分发仍处于 TLS 会话内动态下发的过渡阶段。

### 阶段四：高安全部署增强

可选增强：

1. mTLS
2. 证书钉扎
3. PoP Token 或 DPoP 风格持有者证明
4. 高风险工具增加二次授权

## 11. 验收标准

### 功能验收

1. Client 只在 `ready` 状态处理 `tool_call`
2. `register` 成功后 client 能保存 `user_id/client_id/connection_id/session_id/server_key_id/server_time/server_public_key`
3. 每个 `tool_call` 都包含完整 `meta`
4. 任何一项校验失败都不会执行本地工具

### 安全验收

至少覆盖以下负向用例：

1. 证书 hostname 不匹配，连接失败
2. `tool_call.user_id` 不匹配，拒绝
3. `tool_call.client_id` 不匹配，拒绝
4. `tool_call.connection_id` 不匹配，拒绝
5. `tool_call.session_id` 不匹配，拒绝
6. `tool_call.exp` 已过期，拒绝
7. `tool_call.nonce` 重复，拒绝
8. `tool_call.arguments` 被篡改导致 `body_sha256` 不匹配，拒绝
9. `tool_call.signature` 非法，拒绝

### 观测验收

1. 审计日志能区分 `user_mismatch`、`connection_mismatch`、`replay_detected`、`invalid_signature`
2. 不记录 token 明文
3. 能从日志中关联 `request_id`、`connection_id`、`session_id`

## 12. 残留风险

即使本文方案全部落地，仍然有以下残留风险：

1. 本地终端已被恶意软件控制
2. 服务端本身已被攻破，能合法产生有效签名请求
3. 使用 `full-local-admin` 时，本地工具能力面本来就高
4. 如果 client 仅通过当前 TLS 会话动态拿公钥，而没有做公钥钉扎，则无法完全防住 TLS 终止后的内部中间层

因此，这份设计的真实目标不是“绝对不可能被攻击”，而是把 `managed-client-mcp-ws` 从“只有链路机密性”推进到“链路机密性 + 请求归属可信 + 请求完整性可信 + 请求时效可信”。

## 13. 一句话结论

在当前 `managed-client-mcp-ws` 模型下，防止中间人攻击不能只靠 TLS，也不能只靠 `user_id/client_id/connection_id` 绑定。

可落地的正确做法是：

1. 强制 `wss` 和严格证书校验
2. 去掉 query-string token
3. 在 `register` 后锁定 `user_id/client_id/connection_id/session_id`
4. 为每个 `tool_call` 增加 `iat/exp/nonce/body_sha256/signature`
5. 由 client 做严格校验，任何失败都不执行本地工具

当前实现已经覆盖以上五点的基础版本，但要进一步提升到更强抗 MITM 等级，仍需要把 `server_public_key` 从动态分发升级为更强的信任锚方案。