# LandGod Link — Python SDK

Agent Sidecar Gateway for remote device management.

## Install

```bash
pip install landgod-link
```

## Usage

```python
from landgod_link import LandGod

link = LandGod('http://localhost:8081')
result = link.execute_sync('hostname', target='ZhouTest4')
print(result['stdout'])
```

