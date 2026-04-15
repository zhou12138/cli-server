# 📋 LandGod TODO

## 部署方式

### ✅ 已完成
- [x] **A. Push 模式** — `landgod-deploy.sh` 大侠 SSH 推送安装
- [x] **C. 手动模式** — `SETUP.md` 文档指引

### 🔲 待开发
- [ ] **P0** Push 脚本支持 `--gateway-url` 参数（当前写死 `ws://localhost:8080`）
- [ ] **P1** Pull 模式自助安装脚本 `landgod-bootstrap.sh`
  - 新机器执行一条命令自动安装连接
  - `curl ... | bash -s -- --gateway "ws://x.x.x.x:8080" --token "tok_xxx" --name "my-device"`
- [ ] **P2** Docker 镜像预装
- [ ] **P2** Windows Pull 模式 `landgod-bootstrap.ps1`

## 安全加固

- [ ] **P0** 移除 `bash`/`sh` 白名单（可绕过所有限制）
- [ ] **P0** 配置文件路径保护（shell_execute 禁止访问 config 目录）
- [ ] **P1** 每设备独立 Token（deploy 脚本自动生成）
- [ ] **P1** 签名密钥持久化（Gateway 重启不丢失）
- [ ] **P2** 分级审批（高危操作需人工确认）
- [ ] **P2** SSH 密钥按设备隔离

## 功能开发

- [ ] **P1** `POST /batch_tool_call` 并行批量接口（MapReduce 支持）
- [ ] **P1** Gateway 连接 Cloudflare Tunnel 一键支持
- [ ] **P2** Worker 掉线自动重连 + 通知
- [ ] **P2** landgod-link systemd 服务（Gateway 开机自启）
- [ ] **P2** Worker systemd 服务（部署脚本已有，需测试）

## 代码质量

- [ ] **P1** `bin/landgod.js` 拆分模块（887 行单文件）
- [ ] **P1** `mcp-ws-runtime.ts` 拆分（1724 行）
- [ ] **P2** 添加单元测试（tool-defense、签名验证）
- [ ] **P2** CI/CD — GitHub Actions: lint + test + build
- [ ] **P3** 统一 logger（替代 console.log）

## 文档

- [x] `downloads/SETUP.md` — 完整搭建指南
- [x] `downloads/README.md` — 产物说明 + API 文档
- [x] 网络环境方案（5 种场景）
- [ ] **P2** `CONTRIBUTING.md` — 贡献指南
- [ ] **P2** `clawlink/protocol/PROTOCOL.md` — 协议规范文档

## 命名迁移

- [x] `clawnode` → `landgod`
- [x] `clawlink` → `landgod-link`
- [x] `XClawNode` → `LandGod`
- [ ] **P3** 仓库名 `cli-server` → `landgod`（需要你操作 GitHub）
