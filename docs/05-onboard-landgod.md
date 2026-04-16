# Onboard LandGod Worker — 模板化配置

## 快速配置模板

### 模板 A：基础模式（最小权限）

```bash
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "ws://<GATEWAY>:8080"
landgod config set token "<TOKEN>"
landgod config set toolCallApprovalMode auto
landgod config set builtInTools.permissionProfile command-only
landgod config set builtInTools.shellExecute.enabled true
landgod config set builtInTools.shellExecute.allowedExecutableNames '["echo","ls","cat","whoami","hostname","uname","pwd"]'
landgod config set builtInTools.shellExecute.allowedWorkingDirectories '["/tmp"]'
```

适合：只读巡检、状态查询。

### 模板 B：开发模式（常用开发工具）

```bash
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "ws://<GATEWAY>:8080"
landgod config set token "<TOKEN>"
landgod config set toolCallApprovalMode auto
landgod config set builtInTools.permissionProfile interactive-trusted
landgod config set builtInTools.shellExecute.enabled true
landgod config set builtInTools.shellExecute.allowedExecutableNames '["git","node","npm","npx","python","python3","echo","ls","cat","whoami","hostname","uname","pwd","curl","grep","wc","free","df","ps","nproc"]'
landgod config set builtInTools.shellExecute.allowedWorkingDirectories '["/home/<USER>","/tmp"]'
```

适合：开发环境、CI/CD。

### 模板 C：管理员模式（完整权限）

```bash
landgod config set enabled true
landgod config set mode managed-client-mcp-ws
landgod config set bootstrapBaseUrl "ws://<GATEWAY>:8080"
landgod config set token "<TOKEN>"
landgod config set toolCallApprovalMode auto
landgod config set builtInTools.permissionProfile full-local-admin
landgod config set builtInTools.shellExecute.enabled true
landgod config set builtInTools.shellExecute.allowedExecutableNames '["git","node","npm","npx","python","python3","echo","ls","cat","whoami","hostname","uname","pwd","curl","grep","wc","free","df","ps","nproc","mkdir","rm","cp","mv","chmod","chown","systemctl","apt","yum"]'
landgod config set builtInTools.shellExecute.allowedWorkingDirectories '["/home/<USER>","/tmp","/var","/etc"]'
```

适合：运维管理、完全控制。

⚠️ **安全提示**：不建议在白名单中添加 `bash`、`sh`，这会绕过所有命令限制。

---

## 替换占位符

| 占位符 | 替换为 | 示例 |
|--------|--------|------|
| `<GATEWAY>` | Gateway 机器地址 | `localhost`、`192.168.1.100`、`20.205.20.239` |
| `<TOKEN>` | 设备 Token | `hardcoded-token-1234` 或 `tok_xxx` |
| `<USER>` | 当前用户名 | `azureuser`、`root` |

---

## 启动

```bash
# Headless 模式（推荐）
landgod daemon start --headless

# Electron 模式
landgod daemon start
```

---

## 验证连接

在 Gateway 机器上：
```bash
curl -s http://localhost:8081/clients
```

应看到新设备出现。

---

## 交互式配置（可选）

```bash
landgod onboard   # 引导式配置向导
landgod config     # 交互式编辑所有配置项
```

---

## 配置文件位置

```bash
landgod config show   # 查看当前配置
```

配置文件：`<安装目录>/managed-client.config.json`

---

## 权限配置文件对比

| 配置项 | command-only | interactive-trusted | full-local-admin |
|--------|-------------|-------------------|-----------------|
| shell_execute | ✅ | ✅ | ✅ |
| file_read | ❌ | ❌ | ✅ |
| session_* | ❌ | ✅ (部分) | ✅ |
| remote_configure_mcp | ❌ | ❌ | ✅ |
| 管道/重定向 | ❌ | ✅ | ✅ |
| 网络命令 | ❌ | ❌ | ✅ |
| 内联脚本 | ❌ | ❌ | ✅ |
