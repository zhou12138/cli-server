# LandGod 启动模式对比：GUI vs Headless

## 一句话总结

| 模式 | 一句话 |
|------|--------|
| **GUI** | 有界面，能看到状态面板，适合桌面电脑 |
| **Headless** | 无界面，纯后台运行，适合服务器 |

---

## 详细对比

| 维度 | GUI 模式 | Headless 模式 |
|------|---------|--------------|
| **启动命令** | `landgod start` | `landgod start --headless` |
| **界面** | ✅ Electron 桌面窗口 | ❌ 无界面 |
| **依赖 Electron** | ✅ 需要（~170MB） | ❌ 不需要 |
| **依赖系统库** | ✅ libgtk, libnss, libasound... | ❌ 无 |
| **依赖虚拟显示** | ✅ 服务器需要 xvfb | ❌ 不需要 |
| **安装后额外步骤** | `npm install` + 系统依赖 | 无 |
| **安装时间** | 5-10 分钟 | 10 秒 |
| **内存占用** | ~200MB | ~50MB |
| **跨平台** | 主要 Linux | ✅ Linux / macOS / Windows |
| **Docker 友好** | ❌ 镜像 ~500MB | ✅ 镜像 ~80MB |
| **功能差异** | 有状态面板、托盘图标 | 功能完全相同（无 UI） |
| **远程管理能力** | 相同 | 相同 |
| **MCP 插件支持** | 相同 | 相同 |
| **适合场景** | 桌面开发机、需要可视化 | 服务器、容器、批量部署 |

---

## 功能对等

两种模式在**远程管理能力上完全相同**：

| 功能 | GUI | Headless |
|------|-----|----------|
| WebSocket 连接 Gateway | ✅ | ✅ |
| shell_execute | ✅ | ✅ |
| file_read | ✅ | ✅ |
| session_create/stdin/read/wait | ✅ | ✅ |
| remote_configure_mcp_server | ✅ | ✅ |
| 外部 MCP 插件 (Playwright 等) | ✅ | ✅ |
| Ed25519 签名验证 | ✅ | ✅ |
| 审计日志 | ✅ | ✅ |
| 命令白名单 | ✅ | ✅ |

**唯一区别是 GUI 模式多了一个 Electron 桌面窗口**，可以在本地查看状态、审计日志、活动日志等。这些信息在 Headless 模式下通过 CLI 命令同样可以查看：

```bash
landgod status          # 对应 GUI 的 Dashboard
landgod audit           # 对应 GUI 的 Audit Log 页面
landgod activities      # 对应 GUI 的 Activities 页面
landgod config show     # 对应 GUI 的 Settings 页面
```

---

## 如何选择

```
Q: 你的机器有桌面环境吗？
  → 没有（服务器 / 容器）→ Headless ✅
  → 有 ↓

Q: 你需要可视化状态面板吗？
  → 需要 → GUI
  → 不需要 → Headless ✅（更轻量）
```

**绝大多数场景选 Headless**。GUI 仅在需要本地可视化时使用。

---

## 技术原理

### GUI 模式

```
landgod start
  ↓
启动 Electron 进程
  ├── 渲染进程 (React UI)   → 桌面窗口
  └── 主进程 (Node.js)      → managed-client-mcp-ws 运行时
       ├── WebSocket 连接 Gateway
       ├── 工具执行
       └── MCP 插件管理
```

### Headless 模式

```
landgod start --headless
  ↓
启动 Node.js 进程 (headless-bootstrap.js)
  └── mock Electron API → 直接运行 managed-client-mcp-ws 运行时
       ├── WebSocket 连接 Gateway
       ├── 工具执行
       └── MCP 插件管理
```

Headless 模式通过 `headless-bootstrap.js` mock 了 Electron 的 API（`app.getPath`、`BrowserWindow`、`ipcMain` 等），使相同的运行时代码可以在纯 Node.js 环境中运行，无需 Electron 二进制。
