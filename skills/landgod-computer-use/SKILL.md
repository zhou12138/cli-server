---
name: landgod-computer-use
description: Deploy and use the LandGod Computer Use MCP server for Windows desktop automation via PyAutoGUI. Use when an agent needs to control a remote Windows GUI — take screenshots, click buttons, type text, scroll, or automate desktop applications. Covers installation on Windows workers, MCP server configuration, and usage patterns (screenshot→analyze→click workflow). NOT for web-only automation (use Playwright instead).
---

# LandGod Computer Use — Desktop Automation via MCP

Control remote Windows (or Linux/Mac with display) desktops through LandGod workers.

## Quick Reference

| Tool | Action |
|------|--------|
| `computer-use.computer_screenshot` | Capture screen (JPEG, ~10KB) |
| `computer-use.computer_click` | Click at x,y coordinates |
| `computer-use.computer_type` | Type text, press keys, hotkeys |
| `computer-use.computer_scroll` | Scroll up/down/left/right |

## Environment Requirements

### GPU vs No-GPU Decision Tree

```
Target machine has GPU/display? 
  ├─ YES → Install & use directly (no special setup)
  └─ NO (cloud VM) → Must use standard RDP client
       ├─ RDP connected → Start Worker IN RDP desktop → works
       └─ Only VNC/SSH → ❌ Screenshot won't work
```

**One rule:** Has GPU = direct. No GPU = need RDP.

### Cloud VM Compatibility

| Setup | Screenshot | Click/Type/Scroll |
|-------|-----------|-------------------|
| Physical PC with display | ✅ | ✅ |
| Cloud VM + standard RDP | ✅ (start Worker in RDP) | ✅ |
| Cloud VM + VNC console only | ❌ | ✅ |
| Cloud VM + SSH only | ❌ | ✅ |

## Installation (Step by Step)

### Step 1: Install Python package on Worker

```bash
pip install https://github.com/zhou12138/cli-server/raw/master/downloads/landgod_computer_use-0.1.0-py3-none-any.whl
```

China network? Use mirror:
```bash
pip install <path-to-whl> -i https://mirrors.aliyun.com/pypi/simple/
```

### Step 2: Configure MCP Server

In Worker's landgod directory, create `managed-client.mcp-servers.json`:

```json
{
  "computer-use": {
    "enabled": true,
    "transport": "stdio",
    "command": "python",
    "args": ["-m", "landgod_computer_use"],
    "trustLevel": "trusted",
    "publishedRemotely": true,
    "tools": ["computer_screenshot", "computer_click", "computer_type", "computer_scroll"]
  }
}
```

⚠️ `trustLevel` MUST be `"trusted"`. `"experimental"` blocks remote publication.

### Step 3: Registry settings (Windows Server only)

```cmd
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v fDisableWallpaper /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v fEnableVirtualizedGraphics /t REG_DWORD /d 1 /f
```

### Step 4: Start Worker

**With GPU/display (easy):**
```bash
landgod daemon start --headless
```

**Cloud VM without GPU (must use RDP):**
1. Connect via standard RDP client (mstsc.exe, NOT cloud VNC)
2. Open cmd IN the RDP desktop
3. Run: `cd /d C:\...\landgod && node .vite\build\headless-entry.js`
4. Keep RDP connected (disconnect OK, logout NOT OK)

⚠️ PsExec/SSH/schtasks won't work for screenshot — Worker must be started directly by user in RDP desktop.

### Step 5: Verify

```bash
curl http://localhost:8081/tools
# Should show computer-use.computer_screenshot, computer_click, computer_type, computer_scroll
```

## Usage

### Screenshot (MCP tool — preferred)

```bash
curl -X POST http://localhost:8081/tool_call \
  -d '{"clientName":"WindowsPC","tool_name":"computer-use.computer_screenshot","arguments":{"max_width":800,"quality":40}}'
```

Returns JPEG base64, ~10KB. Default: 800px width, quality 40.

### Screenshot (shell fallback — if MCP times out)

```bash
# Pre-encode python script as base64
SCRIPT=$(echo 'import pyautogui,base64,io
img=pyautogui.screenshot()
r=800/img.width
img=img.resize((800,int(img.height*r)))
buf=io.BytesIO()
img.save(buf,format="JPEG",quality=40)
print(base64.b64encode(buf.getvalue()).decode())' | base64 -w0)

curl -X POST http://localhost:8081/tool_call \
  -d "{\"clientName\":\"WindowsPC\",\"tool_name\":\"shell_execute\",\"arguments\":{\"command\":\"python -c \\\"import base64 as b;exec(b.b64decode('$SCRIPT'))\\\"\"}}"
# Decode stdout base64 → save as .jpg
```

### Click

```bash
# Single click
{"tool_name":"computer-use.computer_click","arguments":{"x":500,"y":300}}

# Double click
{"tool_name":"computer-use.computer_click","arguments":{"x":500,"y":300,"clicks":2}}

# Right click
{"tool_name":"computer-use.computer_click","arguments":{"x":500,"y":300,"button":"right"}}
```

### Type

```bash
# Text
{"tool_name":"computer-use.computer_type","arguments":{"text":"Hello World"}}

# Single key
{"tool_name":"computer-use.computer_type","arguments":{"key":"enter"}}

# Hotkey
{"tool_name":"computer-use.computer_type","arguments":{"hotkey":["ctrl","c"]}}
{"tool_name":"computer-use.computer_type","arguments":{"hotkey":["alt","f4"]}}
{"tool_name":"computer-use.computer_type","arguments":{"hotkey":["ctrl","shift","escape"]}}
```

### Scroll

```bash
# Down
{"tool_name":"computer-use.computer_scroll","arguments":{"amount":-5}}

# Up
{"tool_name":"computer-use.computer_scroll","arguments":{"amount":3}}
```

## Workflow: Screenshot → Analyze → Act

```
1. computer_screenshot          → Get screen image
2. Analyze image (or send to user) → Find element coordinates
3. computer_click/type/scroll   → Interact
4. computer_screenshot          → Verify result
```

## Coordinate System

Screenshots are resized (default 800px width). Screen coordinates are ORIGINAL resolution.

```
Screenshot 800x450 → element at pixel (200, 100)
Screen is 2560x1440 → actual coordinate: (200 * 2560/800, 100 * 1440/450) = (640, 320)
```

⚠️ Always use screen coordinates for click, not screenshot coordinates.

Use `screen_width` and `screen_height` from screenshot response to calculate.

## Shell Escaping Tip

Use base64 encoding for python scripts to avoid JSON → shell → python triple escaping:

```bash
SCRIPT=$(echo 'print("hello")' | base64 -w0)
python -c "import base64 as b;exec(b.b64decode('$SCRIPT'))"
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `screen grab failed` | No GPU + no RDP session | Connect via standard RDP, start Worker in RDP |
| `screen grab failed` (with RDP) | Worker started via SSH/PsExec | Restart Worker directly in RDP cmd |
| MCP tool timeout | Image too large | Use `max_width:800, quality:40` or shell fallback |
| Tools not in `/tools` | MCP config missing or trustLevel wrong | Check `managed-client.mcp-servers.json`, set `trustLevel:"trusted"` |
| `WinError 6` | Old version of computer-use | Update to latest whl |
| Click lands wrong spot | Coordinate mismatch | Use screen resolution, not screenshot resolution |

## When to Use This vs Playwright

| | Computer Use | Playwright |
|---|---|---|
| Target | Any desktop application | Web browsers only |
| Input | Screen coordinates (x, y) | CSS selectors / DOM |
| Use case | Excel, Notepad, OS dialogs, native apps | Web apps, forms, scraping |
| Needs display | Yes | No |
