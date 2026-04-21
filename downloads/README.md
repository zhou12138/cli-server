# 📦 LandGod Downloads

## Packages

| Package | Type | Install On |
|---------|------|-----------|
| `landgod-<VERSION>.tgz` | Worker (Node.js) | Managed devices |
| `landgod-gateway-<VERSION>.tgz` | Gateway (Node.js) | Agent machine |
| `landgod_gateway_server-<VERSION>-py3-none-any.whl` | Gateway (Python) | Agent machine |
| `landgod_gateway-<VERSION>-py3-none-any.whl` | Client SDK (Python) | Agent machine |

## Find Latest Version

```bash
curl -sL https://api.github.com/repos/zhou12138/cli-server/contents/downloads | python3 -c "
import sys,json
for f in json.load(sys.stdin):
    if f['name'].endswith(('.tgz','.whl')):
        print(f['name'])
"
```

## Install from GitHub

```bash
BASE=https://github.com/zhou12138/cli-server/raw/master/downloads

# Node.js Gateway
npm install -g $BASE/landgod-gateway-<VERSION>.tgz

# Python Gateway Server
pip install $BASE/landgod_gateway_server-<VERSION>-py3-none-any.whl

# Node.js Worker
npm install -g $BASE/landgod-<VERSION>.tgz

# Python SDK
pip install $BASE/landgod_gateway-<VERSION>-py3-none-any.whl
```

> Replace `<VERSION>` with the version from the listing above (e.g. `0.1.1`).

## Quick Start

1. [Install Gateway](./QUICKSTART-GATEWAY.md)
2. [Install Worker](./QUICKSTART-WORKER.md)

## Documentation

See [docs/](../docs/)
