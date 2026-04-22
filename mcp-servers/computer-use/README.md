# LandGod Computer Use MCP Server

PyAutoGUI-based MCP server that provides desktop automation tools for LandGod workers.

## Tools

| Tool | Description |
|------|-------------|
| `computer_screenshot` | Take full screen or region screenshot (base64) |
| `computer_click` | Click at x,y coordinates (left/right/double) |
| `computer_type` | Type text, press keys, or hotkey combos |
| `computer_scroll` | Scroll up/down/left/right at position |

## Install

```bash
pip install landgod-computer-use
# or from source
pip install .
```

## Usage with LandGod Worker

Add to `managed-client.mcp-servers.json` on the Worker:

```json
{
  "computer-use": {
    "enabled": true,
    "transport": "stdio",
    "command": "python",
    "args": ["-m", "landgod_computer_use"],
    "trustLevel": "trusted",
    "publishedRemotely": true,
    "tools": [
      "computer_screenshot",
      "computer_click",
      "computer_type",
      "computer_scroll"
    ]
  }
}
```

Then restart the worker. The 4 tools will appear in `GET /tools`.

## Example Usage via LandGod Gateway

```bash
# Take screenshot
curl -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"WindowsPC","tool_name":"computer_screenshot","arguments":{}}'

# Click at coordinates
curl -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"WindowsPC","tool_name":"computer_click","arguments":{"x":500,"y":300}}'

# Type text
curl -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"WindowsPC","tool_name":"computer_type","arguments":{"text":"Hello World"}}'

# Press Enter
curl -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"WindowsPC","tool_name":"computer_type","arguments":{"key":"enter"}}'

# Ctrl+C (copy)
curl -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"WindowsPC","tool_name":"computer_type","arguments":{"hotkey":["ctrl","c"]}}'

# Scroll down
curl -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"WindowsPC","tool_name":"computer_scroll","arguments":{"amount":-5}}'
```

## Requirements

- Python 3.10+
- Windows (primary target), also works on Linux with display, macOS
- `pyautogui` + `Pillow`
