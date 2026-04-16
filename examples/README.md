# 📂 Examples

LandGod 使用示例和模板。

## 目录

### docker/
Docker 镜像构建文件。

| 文件 | 说明 |
|------|------|
| `Dockerfile.gateway` | Gateway 镜像（~60MB，alpine） |
| `Dockerfile.worker` | Worker Headless 镜像（~80MB，alpine） |

构建：
```bash
docker build -f examples/docker/Dockerfile.gateway -t landgod-gateway .
docker build -f examples/docker/Dockerfile.worker -t landgod-worker .
```

### docker-compose/
一键启动 Gateway + Worker 集群。

```bash
cd examples/docker-compose
docker-compose up -d
```

### config-templates/
Worker 配置文件模板。

| 文件 | 权限级别 | 适合场景 |
|------|---------|---------|
| `managed-client.config.json` | command-only | 只读巡检 |
| `managed-client.full-admin.config.json` | full-local-admin | 完整管理 |

使用前替换占位符：
- `REPLACE_WITH_UUID` — 设备唯一 ID
- `REPLACE_WITH_DEVICE_NAME` — 设备名称
- `REPLACE_WITH_GATEWAY` — Gateway 地址
- `REPLACE_WITH_TOKEN` — 认证 Token
- `REPLACE_WITH_USER` — 系统用户名
