# Managed Client 浏览器登录踩坑记录

## 背景

本次改造目标是把 `managed-client-mcp-ws` 的启动鉴权方式，从手工填写静态 Token，升级为浏览器登录回传 Token。

整体链路如下：

1. Electron 启动本地一次性回调服务。
2. Electron 打开 Societas 前端登录页。
3. 用户在浏览器中完成 Microsoft 登录。
4. 前端从 MSAL 拿到 Token 后，回 POST 到 Electron 本地回调地址。
5. Electron 收到 Token 后继续现有启动流程。

最终方案已经跑通，但中间踩了不少典型坑，下面按现象和根因整理。

---

## 1. 前端一开始就编译不过

### 现象

- Societas 前端启动或 typecheck 失败。
- 报错集中在 `@azure/msal-browser` 相关导入和参数上。

### 根因

- 误用了 `@azure/msal-browser/redirect-bridge` 这类当前版本不存在或不兼容的入口。
- 使用了不被当前 MSAL 版本支持的配置项，比如 `iframeBridgeTimeout`。
- `handleRedirectPromise(...)` 的参数形状也按错了版本文档来写。

### 修复

- 回到当前项目实际安装的 MSAL 版本能力集，不再假设旧桥接接口可用。
- 删除无效配置项。
- 按当前库版本要求修正 `handleRedirectPromise(...)` 的调用。

### 经验

- MSAL 的历史包袱比较重，网上示例容易跨版本失效。
- 这类问题不要靠印象写，先以项目当前锁定版本为准。

---

## 2. `MANAGED_CLIENT_SIGNIN_PAGE_URL` 只靠环境变量不够用

### 现象

- 启动时只能配 `MANAGED_CLIENT_BASE_URL`，但浏览器登录页地址也需要频繁切换。
- 每次改环境变量或者启动参数，联调成本高。

### 根因

- 初版实现只把 sign-in page URL 作为内部配置读取，没有进启动表单，也没有持久化到 managed client 配置文件。

### 修复

- 给 managed client 配置增加 `signinPageUrl`。
- 在启动 UI 中新增 `MANAGED_CLIENT_SIGNIN_PAGE_URL` 输入项。
- 让它和 `MANAGED_CLIENT_BASE_URL` 一样参与启动态回填和保存。

### 经验

- 只要是联调阶段高频变化的地址，都应该进 UI 表单和持久化配置，不要只藏在 env 里。

---

## 3. 用户填写 `http://127.0.0.1:3000` 时，登录页路径不完整

### 现象

- 用户只填了站点根地址，例如 `http://127.0.0.1:3000`。
- Electron 打开的页面不是预期的桌面登录页，或者后续逻辑缺少必要参数入口。

### 根因

- 初版实现默认认为传入的是完整登录页 URL，没有兼容“只填 origin”的情况。

### 修复

- 增加 URL 规范化逻辑。
- 如果用户只填了根地址，则自动补成 `/desktop-signin`。

### 经验

- 配置项的输入门槛要尽量低，尤其是 URL 这种，尽量支持“最短可用输入”。

---

## 4. AAD 报 `invalid_request`，提示 `redirect_uri` 不匹配

### 现象

- 浏览器已经跳到 Microsoft 登录，但回调时报 Azure AD 的 `invalid_request`。
- 提示 `redirect_uri` 和应用注册配置不一致。

### 根因

- Societas 前端的 MSAL `redirectUri` 是基于 `window.location.origin` 计算的。
- 本地启动时如果页面是 `127.0.0.1`，那它算出来的也是 `http://127.0.0.1:3000/`。
- 但 AAD 里实际登记的是 `http://localhost:3000/`。
- `localhost` 和 `127.0.0.1` 在 AAD 看来不是一回事，必须精确匹配。

### 修复

- 对登录页 URL 做 loopback 主机名归一化。
- 把 `127.0.0.1`、`0.0.0.0`、`::1` 等统一改写为 `localhost`。

### 经验

- 本地回环地址虽然都指向本机，但在 OAuth/AAD 场景里，主机名是严格参与匹配的。
- 只要涉及 redirect URI，必须从一开始就统一规范。

---

## 5. 浏览器显示“继续登录”后又提示 `login failed`

### 现象

- 用户完成 Microsoft 登录后，桌面回传本来应该结束。
- 但 Societas 前端又继续走自己原有站内登录完成逻辑，最后弹出 `login failed`。

### 根因

- 桌面登录和 Web 站点自身登录共用了同一套 redirect handler。
- 桌面分支成功把 Token 回传给 Electron 后，没有及时短路返回。
- 导致后面又继续执行站内用户初始化、组织校验或页面跳转逻辑。

### 修复

- 在 `redirect-handler.ts` 中增加桌面登录分支。
- 只要识别到当前请求属于 desktop handoff：
  - 先把 Token POST 回 Electron。
  - 成功后直接跳到 `/desktop-signin-complete`。
  - 不再继续执行普通 Web 登录收尾流程。

### 经验

- “复用现有登录逻辑”只能复用到取 Token 为止。
- 后续收尾动作如果场景不同，必须显式分流。

---

## 6. 页面报 `stubbed_public_client_application_called`

### 现象

- 打开桌面登录页时，MSAL 相关 hook 直接报 `stubbed_public_client_application_called`。

### 根因

- 代码里调用了 `useMsal()`，但应用根部并没有真正挂 `MsalProvider`。
- 结果拿到的是 stub，而不是初始化后的 MSAL 实例。

### 修复

- 在应用顶层 providers 中初始化 `getMsalInstance()`。
- 用真实的 `MsalProvider` 包住整个应用。

### 经验

- 只要项目里有 `useMsal()`，就必须先确认 Provider 树是真实生效的。
- 不能因为原流程“碰巧能跑”就默认 Provider 已经接好了。

---

## 7. 登录完成后又回到首页，桌面回调信息丢了

### 现象

- 浏览器完成 Microsoft 登录后，没有回到桌面收尾页。
- 反而又落回前端首页，或继续报通用登录失败。

### 根因

- 初版代码把 `authResult.state` 当作原始 JSON 来解析。
- 实际上 MSAL 会把自定义 state 包装成：`base64(libraryState)|userState`。
- 直接 `JSON.parse(authResult.state)` 会失败，导致取不到桌面登录所需的 `callbackUrl` 和 `nonce`。

### 修复

- 在 `desktop-handoff.ts` 中改造 state 解析逻辑：
  - 兼容 MSAL 包装格式。
  - 提取真正的 `userState`。
  - 必要时兼容 percent-encoded 内容。
- 同时在跳转前把桌面回调信息额外存到 `sessionStorage`。
- redirect 返回后，优先解析 `authResult.state`，失败时再从 `sessionStorage` 兜底恢复。

### 经验

- OAuth/MSAL 的 state 往返不要假设“原样返回”。
- 关键跨跳转上下文必须做双保险存储。

---

## 8. `/desktop-signin` 页面点击登录后报 `Failed to fetch`

### 现象

- 浏览器页上点“Sign In With Microsoft”看起来没反应，或者直接显示 `Failed to fetch`。
- 说明前端在回传 Token 给 Electron 时失败了。

### 根因

- Electron 本地回调地址最初用的是 `127.0.0.1`。
- 浏览器登录页和整条链路前面已经逐步规范到 `localhost`。
- 在实际环境里，浏览器到本地回调的连通/策略表现不稳定，错误信息又过于笼统，只看到通用 `Failed to fetch`，定位困难。
- 当登录页运行在 `https://...` 上时，浏览器对发往 `http://127.0.0.1` 或 `http://localhost` 的 `fetch` 还会触发 Private Network Access 预检。
- 如果本地 callback 服务没有在 `OPTIONS` 预检响应里返回 `Access-Control-Allow-Private-Network: true`，浏览器也会把最终结果表现成 `Failed to fetch`。

### 修复

- 让 Electron 本地回调服务的监听地址和生成出来的 callback URL 保持一致，避免监听在 `127.0.0.1` 却把 `localhost` 发给浏览器，导致部分机器上命中 IPv6/`::1` 解析差异。
- 让 callback 服务显式处理 Private Network Access 预检，返回 `Access-Control-Allow-Private-Network: true`。
- 给浏览器侧 POST callback 增加显式错误包装，例如指出无法访问桌面回调地址。
- 补充桌面登录页阶段状态展示，以及 Electron 回调生命周期日志，方便确认卡在哪一步。

### 经验

- 本地 OAuth 联调里，回调服务监听地址和实际发给浏览器的 callback URL 必须严格一致，不能混用 `localhost` 和 `127.0.0.1` 再指望系统解析总是一样。
- 从 `https` 页面回调到本地 `http://127.0.0.1`/`http://localhost` 时，不能只看传统 CORS，还要考虑 Private Network Access 预检。
- 网络错误如果只显示 `Failed to fetch`，几乎没有排查价值，必须补上下文。

---

## 9. 这次改造里最关键的几个稳定性措施

最终能稳定跑通，核心不是某一个补丁，而是下面几件事一起到位：

1. Electron 和前端都统一使用 `localhost`。
2. `MANAGED_CLIENT_SIGNIN_PAGE_URL` 可配置、可持久化、可自动补 `/desktop-signin`。
3. Societas 前端根部接入真实 `MsalProvider`。
4. redirect handler 中把 desktop handoff 和普通 Web 登录彻底分流。
5. 正确解析 MSAL 包装后的 state。
6. 用 `sessionStorage` 保存 pending desktop signin 状态做兜底。
7. 回调 POST 失败时提供可定位的错误信息。

---

## 最终落地结果

当前方案已经满足以下目标：

- `managed-client-mcp-ws` 支持浏览器登录。
- 登录完成后，Token 能成功回传给 Electron 并继续启动。
- 静态 Token 输入仍然保留，可作为兜底方案。
- `MANAGED_CLIENT_SIGNIN_PAGE_URL` 已支持启动表单配置。

---

## 后续建议

### 1. UI 层面标清主路径和兜底路径

- 浏览器登录已经是主流程。
- 静态 Token 更适合作为 fallback，可以在 UI 上弱化或标注“仅排障/兜底使用”。

### 2. 保留最少但够用的调试信息

- 这次联调加过一些日志。
- 不建议全部删光，至少保留 callback 启动、收到回调、回调失败原因这几类关键信息。

### 3. 后续如果要做刷新 Token，再单独设计

- 当前链路解决的是“首次登录成功回传”。
- 刷新策略、过期续签、Electron 侧安全存储应作为下一阶段独立设计，不建议混在本次改造里补。

---

## 一句话总结

这次最大的坑，不是 Microsoft 登录本身，而是桌面应用、浏览器前端、MSAL、AAD 回调这四段链路对“状态”和“地址”的一致性要求非常高。只要 `localhost`、state 解析、Provider、分流逻辑里有一个没对齐，最终表现都会像“登录了但就是收不回来”。