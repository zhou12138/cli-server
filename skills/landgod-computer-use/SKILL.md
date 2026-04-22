---
name: landgod-computer-use
description: Deploy and use the LandGod Computer Use MCP server for Windows desktop automation via PyAutoGUI. Use when an agent needs to control a remote Windows GUI — take screenshots, click buttons, type text, scroll, or automate desktop applications. Covers installation on Windows workers, MCP server configuration, and usage patterns (screenshot→analyze→click workflow). NOT for web-only automation (use Playwright instead).
---

# LandGod Computer Use — Desktop Automation via MCP

Control remote Windows (or Linux/Mac with display) desktops through LandGod workers.

## What It Does

4 tools for GUI automation:

| Tool | Action | Example |
|------|--------|---------|
| `computer_screenshot` | Capture screen (base64 image) | See what's on the desktop |
| `computer_click` | Click at x,y coordinates | Click a button, icon, menu |
| `computer_type` | Type text, press keys, hotkeys | Fill forms, Ctrl+C, Alt+F4 |
| `computer_scroll` | Scroll up/down/left/right | Navigate long pages |

## Prerequisites

- A LandGod Worker running on a machine **with a display** (Windows desktop, Linux with X11, macOS)
- Python 3.10+ on the worker
- Worker connected to Gateway (see `landgod-setup` skill)

## Step 1: Install on Worker

Via LandGod Gateway (remote install):
```bash
curl -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"<WINDOWS_WORKER>","tool_name":"shell_execute","arguments":{
    "command":"pip install https://github.com/zhou12138/cli-server/raw/master/downloads/landgod_computer_use-0.1.0-py3-none-any.whl"
  }}'
```

Or directly on the worker:
```bash
pip install https://github.com/zhou12138/cli-server/raw/master/downloads/landgod_computer_use-0.1.0-py3-none-any.whl
```

Verify:
```bash
python -m landgod_computer_use  # Should start and wait for stdin
# Ctrl+C to exit
```

## Step 2: Configure MCP Server on Worker

Edit or create `managed-client.mcp-servers.json` in the worker's landgod directory:

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

⚠️ **All 4 tool names must be listed exactly.** Missing names = tools won't appear in Gateway.

⚠️ **`trustLevel` must be `"trusted"`** (not `"experimental"`). Otherwise tools won't be published remotely.

## Step 3: Restart Worker

```bash
# Kill and restart the worker process
# Windows:
taskkill /F /IM node.exe & cd C:\...\landgod & node .vite\build\headless-entry.js

# Linux:
pkill -f headless-entry && cd <landgod-dir> && nohup node .vite/build/headless-entry.js &
```

## Step 4: Verify

From Gateway:
```bash
# Check tools are registered
curl -s http://localhost:8081/tools | python3 -c "
import sys,json
for w in json.load(sys.stdin)['tools']:
    cu = [t for t in w['tools'] if t.startswith('computer_')]
    if cu: print(f\"{w['clientName']}: {cu}\")
"
```

Expected: `WindowsPC: ['computer_screenshot', 'computer_click', 'computer_type', 'computer_scroll']`

## Usage Patterns

### Pattern 1: Screenshot → Analyze → Act

The fundamental workflow for GUI automation:

```
1. computer_screenshot          → See what's on screen
2. Agent analyzes the image     → Identify elements and coordinates
3. computer_click / type        → Interact with the element
4. computer_screenshot          → Verify the action worked
```

### Pattern 2: Open and Use an Application

```bash
# Step 1: Screenshot to see current state
POST /tool_call {"clientName":"WinPC","tool_name":"computer_screenshot","arguments":{}}

# Step 2: Open Start menu
POST /tool_call {"clientName":"WinPC","tool_name":"computer_click","arguments":{"x":20,"y":1060}}

# Step 3: Type app name
POST /tool_call {"clientName":"WinPC","tool_name":"computer_type","arguments":{"text":"notepad"}}

# Step 4: Press Enter to launch
POST /tool_call {"clientName":"WinPC","tool_name":"computer_type","arguments":{"key":"enter"}}

# Step 5: Wait and screenshot to verify
POST /tool_call {"clientName":"WinPC","tool_name":"computer_screenshot","arguments":{}}

# Step 6: Type in the app
POST /tool_call {"clientName":"WinPC","tool_name":"computer_type","arguments":{"text":"Hello from LandGod!"}}

# Step 7: Save (Ctrl+S)
POST /tool_call {"clientName":"WinPC","tool_name":"computer_type","arguments":{"hotkey":["ctrl","s"]}}
```

### Pattern 3: Keyboard Shortcuts

```bash
# Copy
{"tool_name":"computer_type","arguments":{"hotkey":["ctrl","c"]}}

# Paste
{"tool_name":"computer_type","arguments":{"hotkey":["ctrl","v"]}}

# Undo
{"tool_name":"computer_type","arguments":{"hotkey":["ctrl","z"]}}

# Close window
{"tool_name":"computer_type","arguments":{"hotkey":["alt","f4"]}}

# Switch window
{"tool_name":"computer_type","arguments":{"hotkey":["alt","tab"]}}

# Task Manager
{"tool_name":"computer_type","arguments":{"hotkey":["ctrl","shift","escape"]}}

# Windows Run
{"tool_name":"computer_type","arguments":{"hotkey":["win","r"]}}
```

### Pattern 4: Scroll Through Content

```bash
# Scroll down 5 clicks
{"tool_name":"computer_scroll","arguments":{"amount":-5}}

# Scroll up 3 clicks
{"tool_name":"computer_scroll","arguments":{"amount":3}}

# Scroll at specific position
{"tool_name":"computer_scroll","arguments":{"amount":-5,"x":500,"y":400}}
```

### Pattern 5: Label-Based Routing

Configure the Windows worker with a label:
```bash
landgod config set labels '{"gui":true,"platform":"windows"}'
```

Then route GUI tasks by label:
```bash
POST /tool_call {"labels":{"gui":true},"tool_name":"computer_screenshot","arguments":{}}
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Tools don't appear in `/tools` | MCP config missing or wrong tool names | Check `managed-client.mcp-servers.json`, verify all 4 names |
| `trustLevel=experimental` blocks publication | Default from `remote_configure_mcp_server` | Manually set `"trustLevel": "trusted"` |
| Screenshot returns black image | No display / RDP disconnected | Keep RDP session open, or use virtual display |
| Click lands on wrong position | Screen resolution changed | Take fresh screenshot, coordinates are absolute |
| `pyautogui` import error | Not installed on worker | `pip install pyautogui Pillow` |
| Unicode text not typing | `typewrite` only supports ASCII | Use `pyautogui.write()` for Unicode (handled automatically) |

## When to Use This vs Playwright

| | Computer Use (this) | Playwright MCP |
|---|---|---|
| **Target** | Any desktop application | Web browsers only |
| **Input** | Screen coordinates | CSS selectors / DOM |
| **Precision** | Approximate (pixel-based) | Exact (element-based) |
| **Use case** | Excel, Notepad, native apps, OS dialogs | Web apps, forms, scraping |
| **Reliability** | Lower (resolution-dependent) | Higher (DOM-based) |

**Rule of thumb:** If it's in a browser, use Playwright. If it's a native desktop app, use Computer Use.
