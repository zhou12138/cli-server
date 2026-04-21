# LandGod Link — Python SDK

Agent Sidecar Gateway for remote device management.

## Install

```bash
pip install landgod-gateway
```

## Usage

```python
from landgod_gateway import LandGod

link = LandGod('http://localhost:8081')
result = link.execute_sync('hostname', target='ZhouTest4')
print(result['stdout'])
```

