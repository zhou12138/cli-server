# managed-client-mcp-ws Tool Call 认证与用户绑定工程结论

## 背景

当前 `managed-client-mcp-ws` 模式已经具备两层基础认证能力：

1. `client -> server` 通过 Bearer Token 完成客户端身份认证
2. `server -> client` 通过 TLS 完成服务端身份认证

这两层已经能解决：

1. 客户端是否已登录并被服务端接受
2. 客户端当前连接的是否是受信任的目标服务端

但当前仍然缺少一层更细粒度的校验：

1. 某条 `tool_call` 是否来自当前这条已建立的合法连接
2. 某条 `tool_call` 是否确实属于当前登录用户
3. 某条 `tool_call` 是否确实发给当前这个 client，而不是串到了别的 client

换句话说，当前问题不是“链路是不是加密的”，而是“请求是不是属于当前登录用户和当前 client”。

## 目标

目标是在 `managed-client-mcp-ws` 协议里补齐请求级身份绑定，使客户端在执行 `tool_call` 之前，能够明确拒绝以下情况：

1. 服务端把别的用户的请求发到了当前 client
2. 服务端把别的 client 的请求发到了当前 client
3. 旧连接或错误连接上的请求串到了当前连接
4. 缺少身份字段、无法判断归属的 `tool_call`

本阶段先做最小可用版本，不引入请求签名，只做强绑定校验。

## 当前协议现状

当前 `managed-client-mcp-ws` 大致流程如下：

1. 客户端建立 WebSocket 连接
2. 服务端发送 `session_opened`
3. 客户端发送 `register`
4. 客户端发送 `update_tools`
5. 服务端发送 `tool_call`

当前握手阶段已知字段：

1. `session_opened.payload.connection_id`
2. `register` 时客户端会发送：
   - `client_id`
   - `client_name`

当前缺口：

1. 握手阶段没有稳定返回当前登录用户的 `user_id`
2. `tool_call` 当前未要求携带：
   - `user_id`
   - `client_id`
   - `connection_id`
3. 客户端当前无法判断 `tool_call` 是否与当前登录用户匹配

## 最小可用方案

### 一、握手阶段返回当前会话身份

服务端需要在握手阶段把当前会话的身份信息显式返回给客户端。

推荐做法：

1. 在 `session_opened` 中返回：
   - `connection_id`
2. 在 `register` 响应中返回：
   - `ok`
   - `client_id`
   - `user_id`
   - 可选：`tenant_id`
   - 可选：`session_id`

推荐响应示例：

```json
{
  "type": "res",
  "id": "req-register-1",
  "ok": true,
  "payload": {
    "client_id": "client-123",
    "user_id": "user-456",
    "tenant_id": "tenant-789"
  }
}
```

客户端会将以下值保存为当前连接上下文：

1. `expectedConnectionId`
2. `expectedClientId`
3. `expectedUserId`

### 二、每个 tool_call 都携带绑定字段

服务端下发 `tool_call` 时，必须在 payload 中携带以下字段：

1. `tool_name`
2. `arguments`
3. `user_id`
4. `client_id`
5. `connection_id`

推荐 `tool_call` 示例：

```json
{
  "type": "req",
  "id": "tool-call-001",
  "method": "tool_call",
  "params": {
    "tool_name": "session_create",
    "arguments": {
      "command": "whoami"
    },
    "user_id": "user-456",
    "client_id": "client-123",
    "connection_id": "conn-abc"
  }
}
```

### 三、客户端执行前做强校验

客户端在执行 `tool_call` 之前，按以下顺序校验：

1. `tool_name` 存在
2. 本地已存在当前连接上下文：
   - `expectedConnectionId`
   - `expectedClientId`
   - `expectedUserId`
3. `payload.user_id === expectedUserId`
4. `payload.client_id === expectedClientId`
5. `payload.connection_id === expectedConnectionId`

任一失败，直接拒绝执行，并返回结构化错误。

推荐错误码：

1. `missing_binding`
2. `user_mismatch`
3. `client_mismatch`
4. `connection_mismatch`
5. `unbound_session`

推荐错误示例：

```json
{
  "type": "event",
  "event": "tool_error",
  "payload": {
    "request_id": "tool-call-001",
    "code": "user_mismatch",
    "message": "tool_call user_id does not match the authenticated desktop session"
  }
}
```

## 客户端预期行为

服务端支持上述字段后，客户端侧将做如下行为：

1. 在握手阶段保存当前连接的：
   - `connection_id`
   - `client_id`
   - `user_id`
2. 拒绝任何缺少绑定字段的 `tool_call`
3. 拒绝任何与当前会话身份不匹配的 `tool_call`
4. 在 audit log 中记录拒绝原因，但不执行本地工具

## 为什么这一步是必要的

TLS 只能证明：

1. 当前连接对端是受信任服务端

Bearer token 只能证明：

1. 当前 client 登录成功了

但这两者都不能自动证明：

1. 这条 `tool_call` 属于当前登录用户
2. 这条 `tool_call` 属于当前这个 client

因此必须补一层“请求级身份绑定”。

## 为什么本阶段先不做签名

更强版本可以在 `tool_call` 上增加签名、过期时间和防重放字段，例如：

1. `iat`
2. `exp`
3. `nonce`
4. `signature`

但当前最明显的缺口不是“缺少签名”，而是“缺少最基础的 user/client/connection 绑定”。

因此分阶段推进更合理：

1. 第一阶段：先做 `user_id/client_id/connection_id` 强绑定
2. 第二阶段：再做 `iat/exp/nonce/signature`

## 服务端改造要求

服务端至少需要完成以下改动：

1. `register` 响应返回当前认证上下文中的 `user_id`
2. 保证 `register` 响应中的 `client_id` 与当前连接绑定一致
3. 每个 `tool_call` 都填充：
   - `user_id`
   - `client_id`
   - `connection_id`
4. 服务端下发前确保这三个字段来自同一个已认证会话，而不是业务层任意拼装

## 推荐兼容策略

为了避免客户端和服务端同时切换导致中断，推荐按以下顺序推进：

1. 服务端先支持在 `register` 响应中返回 `user_id/client_id`
2. 服务端开始为 `tool_call` 附带 `user_id/client_id/connection_id`
3. 客户端上线严格校验逻辑
4. 如有历史客户端，服务端可在短期内保留兼容模式
5. 一旦新版客户端稳定，服务端再去掉无绑定字段的旧路径

## 后续增强方向

完成本阶段后，建议继续增加以下能力：

1. `tool_call` 增加 `iat` 和 `exp`
2. `tool_call` 增加 `nonce` 防重放
3. 对请求体做签名，防止错误路由或内部消息串改
4. 对高风险工具增加服务端侧二次授权或审批

## 一句话结论

本阶段的核心不是重新做 TLS，而是在现有 TLS 与 Bearer Token 之上，补齐 `tool_call` 的请求级身份绑定。

最小要求就是：

1. `register` 返回当前 `user_id`
2. `tool_call` 携带 `user_id/client_id/connection_id`
3. 客户端执行前必须逐项匹配，否则拒绝执行

## 风险变化结论

这一阶段落地后，风险不会归零，但会明显下降，尤其是以下几类风险：

1. 服务端把 A 用户请求误发给 B 用户客户端
2. 服务端把别的 client 的请求串给当前 client
3. 旧连接上的请求被错误复用到当前连接
4. 缺少身份上下文的 `tool_call` 被客户端直接执行

这一阶段不能单独解决的风险：

1. 本地机器已经失陷或被注入
2. Bearer Token 在其他路径泄漏后被重新建立合法会话
3. 服务端本身已被攻破且能够合法地产生恶意请求
4. `full-local-admin` 模式下本地能力面天然仍然较大

结论上，这一阶段会把 `managed-client-mcp-ws` 从“只具备链路可信”推进到“链路可信 + 请求归属可信”。

## 工程决策

本项目当前建议按以下顺序推进，而不是直接引入请求签名：

1. 先落地 `user_id/client_id/connection_id` 强绑定
2. 再补 `iat/exp/nonce`
3. 最后视需要补 `signature`

原因：

1. 当前最大的缺口是没有请求归属字段，而不是缺少签名
2. 先补归属字段，能以最低协议复杂度解决最现实的串用户和串 client 风险
3. 直接上签名会显著增加前后端复杂度，但不能替代最基础的会话绑定

## 实施范围

### 客户端范围

客户端改造完成后，预期行为如下：

1. 握手阶段保存当前连接上下文：
  - `expectedConnectionId`
  - `expectedClientId`
  - `expectedUserId`
2. `tool_call` 到达时先做身份绑定校验，再决定是否执行本地工具
3. 缺字段或不匹配一律拒绝执行
4. 拒绝事件写入 audit log，并上报结构化错误码

### 服务端范围

服务端改造完成后，预期行为如下：

1. `register` 响应返回与当前认证上下文一致的 `user_id/client_id`
2. `tool_call` 下发前强制附带：
  - `user_id`
  - `client_id`
  - `connection_id`
3. 这三个字段必须来自同一个已认证连接，而不是业务层临时拼接
4. 对历史客户端可保留短期兼容路径，但默认新路径应为强绑定模式

## 推荐上线顺序

建议按以下阶段推进：

1. 文档对齐：明确协议字段、错误码、兼容窗口
2. 服务端先补 `register` 响应中的 `user_id/client_id`
3. 服务端开始在 `tool_call` 中携带 `user_id/client_id/connection_id`
4. 客户端上线严格校验逻辑并默认拒绝缺失绑定字段的请求
5. 观测稳定后，服务端移除旧的无绑定字段路径

## 验收标准

### 功能验收

满足以下条件可认为第一阶段完成：

1. 客户端握手完成后能拿到并保存当前连接的：
  - `connection_id`
  - `client_id`
  - `user_id`
2. 服务端下发的每个 `tool_call` 都包含：
  - `user_id`
  - `client_id`
  - `connection_id`
3. 客户端仅在三项全部匹配时才执行工具
4. 任一字段缺失或不匹配时，客户端返回结构化错误，不执行工具

### 安全验收

至少覆盖以下负向用例：

1. `tool_call.user_id` 与当前登录用户不同，应拒绝
2. `tool_call.client_id` 与当前 client 不同，应拒绝
3. `tool_call.connection_id` 与当前连接不同，应拒绝
4. `tool_call` 缺少任一绑定字段，应拒绝
5. 连接重建后，旧连接残留请求应拒绝

### 观测验收

客户端 audit/event 中至少应能观测到：

1. 当前连接保存的 `connection_id/client_id/user_id`
2. 拒绝执行的错误码
3. 被拒绝请求的 `requestId/toolName`
4. 是否发生了 `user_mismatch/client_mismatch/connection_mismatch`

## 建议错误码语义

为便于联调和日志分析，建议错误码语义固定：

1. `unbound_session`
  - 客户端还没有建立完整的会话绑定上下文
2. `missing_binding`
  - `tool_call` 缺少必须字段
3. `user_mismatch`
  - `tool_call.user_id` 不匹配当前登录用户
4. `client_mismatch`
  - `tool_call.client_id` 不匹配当前 client
5. `connection_mismatch`
  - `tool_call.connection_id` 不匹配当前连接

## 本阶段完成后的安全收益

第一阶段完成后，可以认为本地 client 的暴露面风险会有明显下降，主要体现在：

1. 合法服务端上的错误路由请求不再能被静默执行
2. 错用户、错 client、错连接的 `tool_call` 会被客户端主动拒绝
3. 即使链路 TLS 正常，客户端也不会盲目信任所有来自该连接的 `tool_call`

更准确地说，这一阶段让客户端从“信任这条连接”升级到“信任这条连接上与当前用户和当前 client 匹配的请求”。

## 残留风险与后续优先级

第一阶段之后，仍建议继续按以下优先级推进：

1. 去掉 query-string token，改用更合适的握手认证传递方式
2. 增加 `iat/exp`，收紧请求时效窗口
3. 增加 `nonce`，降低重放风险
4. 对请求体做签名，降低内部消息串改风险
5. 对高风险工具引入更强审批或服务端二次授权

这是因为第一阶段解决的是“请求归属”，不是“请求不可重放”或“服务端内部不可篡改”。

## 工程结论

如果目标是尽快把 `managed-client-mcp-ws` 推进到更接近生产可接受的状态，那么第一阶段最值得优先落地的不是请求签名，而是 `tool_call` 的会话绑定与用户绑定。

原因很直接：

1. 改动面相对可控
2. 风险收益非常直接
3. 能显著降低串用户、串 client、串连接导致的本地暴露面误执行问题
4. 可以为后续 `iat/exp/nonce/signature` 提供稳定基础