"""
LandGod Computer Use MCP Server
================================
PyAutoGUI-based MCP server providing computer_screenshot, computer_click,
computer_type, and computer_scroll tools for Windows desktop automation.

Install: pip install landgod-computer-use
Run:     python -m landgod_computer_use
"""
import base64
import io
import json
import sys
import logging

logger = logging.getLogger("landgod-computer-use")

try:
    import pyautogui
    pyautogui.FAILSAFE = False  # Disable fail-safe for headless operation
    pyautogui.PAUSE = 0.1
except ImportError:
    print("ERROR: pyautogui not installed. Run: pip install pyautogui", file=sys.stderr)
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow", file=sys.stderr)
    sys.exit(1)


# ============================================
# Tool Implementations
# ============================================

def tool_screenshot(arguments: dict) -> dict:
    """Take a screenshot of the entire screen or a region."""
    region = arguments.get("region")  # [x, y, width, height] or None
    max_width = arguments.get("max_width", 1280)
    format_ = arguments.get("format", "png")

    try:
        if region and isinstance(region, list) and len(region) == 4:
            img = pyautogui.screenshot(region=tuple(region))
        else:
            img = pyautogui.screenshot()

        # Resize if too large
        if img.width > max_width:
            ratio = max_width / img.width
            img = img.resize((max_width, int(img.height * ratio)), Image.LANCZOS)

        # Get screen size
        screen_w, screen_h = pyautogui.size()

        # Encode to base64
        buffer = io.BytesIO()
        img.save(buffer, format=format_.upper())
        b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        return {
            "success": True,
            "image_base64": b64,
            "format": format_,
            "width": img.width,
            "height": img.height,
            "screen_width": screen_w,
            "screen_height": screen_h,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def tool_click(arguments: dict) -> dict:
    """Click at specific coordinates or find and click an element."""
    x = arguments.get("x")
    y = arguments.get("y")
    button = arguments.get("button", "left")  # left, right, middle
    clicks = arguments.get("clicks", 1)  # 1 = single, 2 = double
    text = arguments.get("text")  # Optional: find text on screen and click

    try:
        if text:
            # Try to locate text on screen using pyautogui.locateOnScreen
            # This requires an image of the text — fallback to coordinates
            return {"success": False, "error": "Text-based click not supported. Use x,y coordinates. Take a screenshot first to find coordinates."}

        if x is None or y is None:
            return {"success": False, "error": "x and y coordinates are required"}

        pyautogui.click(x=int(x), y=int(y), button=button, clicks=int(clicks))

        return {
            "success": True,
            "action": "click",
            "x": int(x),
            "y": int(y),
            "button": button,
            "clicks": int(clicks),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def tool_type(arguments: dict) -> dict:
    """Type text or press keyboard keys."""
    text = arguments.get("text")
    key = arguments.get("key")  # Single key: enter, tab, escape, etc.
    hotkey = arguments.get("hotkey")  # Key combination: ["ctrl", "c"]
    interval = arguments.get("interval", 0.02)  # Delay between keystrokes

    try:
        if hotkey and isinstance(hotkey, list):
            pyautogui.hotkey(*hotkey)
            return {"success": True, "action": "hotkey", "keys": hotkey}

        if key:
            pyautogui.press(key)
            return {"success": True, "action": "key", "key": key}

        if text:
            pyautogui.typewrite(text, interval=float(interval)) if text.isascii() else pyautogui.write(text)
            return {"success": True, "action": "type", "length": len(text)}

        return {"success": False, "error": "Provide 'text', 'key', or 'hotkey'"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def tool_scroll(arguments: dict) -> dict:
    """Scroll the mouse wheel."""
    amount = arguments.get("amount", -3)  # Positive = up, negative = down
    x = arguments.get("x")  # Optional: scroll at specific position
    y = arguments.get("y")
    direction = arguments.get("direction", "vertical")  # vertical or horizontal

    try:
        kwargs = {}
        if x is not None and y is not None:
            kwargs["x"] = int(x)
            kwargs["y"] = int(y)

        if direction == "horizontal":
            pyautogui.hscroll(int(amount), **kwargs)
        else:
            pyautogui.scroll(int(amount), **kwargs)

        return {
            "success": True,
            "action": "scroll",
            "amount": int(amount),
            "direction": direction,
            "x": kwargs.get("x"),
            "y": kwargs.get("y"),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============================================
# MCP Server Protocol (stdio JSON-RPC)
# ============================================

TOOLS = {
    "computer_screenshot": {
        "name": "computer_screenshot",
        "description": "Take a screenshot of the entire screen or a specific region. Returns base64-encoded image.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "Optional [x, y, width, height] region to capture. Omit for full screen.",
                },
                "max_width": {
                    "type": "integer",
                    "default": 1280,
                    "description": "Maximum image width (auto-resize if larger).",
                },
                "format": {
                    "type": "string",
                    "enum": ["png", "jpeg"],
                    "default": "png",
                    "description": "Image format.",
                },
            },
        },
    },
    "computer_click": {
        "name": "computer_click",
        "description": "Click at specific screen coordinates. Take a screenshot first to find the right coordinates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "x": {"type": "integer", "description": "X coordinate on screen."},
                "y": {"type": "integer", "description": "Y coordinate on screen."},
                "button": {
                    "type": "string",
                    "enum": ["left", "right", "middle"],
                    "default": "left",
                    "description": "Mouse button.",
                },
                "clicks": {
                    "type": "integer",
                    "default": 1,
                    "description": "Number of clicks (2 for double-click).",
                },
            },
            "required": ["x", "y"],
        },
    },
    "computer_type": {
        "name": "computer_type",
        "description": "Type text, press a key, or use keyboard shortcuts (hotkeys).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to type."},
                "key": {
                    "type": "string",
                    "description": "Single key to press (enter, tab, escape, backspace, delete, up, down, left, right, f1-f12, etc.).",
                },
                "hotkey": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": 'Key combination, e.g. ["ctrl", "c"] for copy, ["alt", "f4"] for close.',
                },
                "interval": {
                    "type": "number",
                    "default": 0.02,
                    "description": "Delay between keystrokes in seconds.",
                },
            },
        },
    },
    "computer_scroll": {
        "name": "computer_scroll",
        "description": "Scroll the mouse wheel up or down, optionally at a specific screen position.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "amount": {
                    "type": "integer",
                    "default": -3,
                    "description": "Scroll amount. Positive = up, negative = down.",
                },
                "x": {"type": "integer", "description": "Optional X coordinate to scroll at."},
                "y": {"type": "integer", "description": "Optional Y coordinate to scroll at."},
                "direction": {
                    "type": "string",
                    "enum": ["vertical", "horizontal"],
                    "default": "vertical",
                    "description": "Scroll direction.",
                },
            },
        },
    },
}

TOOL_HANDLERS = {
    "computer_screenshot": tool_screenshot,
    "computer_click": tool_click,
    "computer_type": tool_type,
    "computer_scroll": tool_scroll,
}


def handle_message(msg: dict) -> dict | None:
    """Handle a JSON-RPC message and return a response."""
    method = msg.get("method", "")
    msg_id = msg.get("id")
    params = msg.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "landgod-computer-use",
                    "version": "0.1.0",
                },
            },
        }

    if method == "notifications/initialized":
        return None  # No response for notifications

    if method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {"tools": list(TOOLS.values())},
        }

    if method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})

        handler = TOOL_HANDLERS.get(tool_name)
        if not handler:
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps({"error": f"Unknown tool: {tool_name}"})}],
                    "isError": True,
                },
            }

        result = handler(arguments)
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result)}],
                "isError": not result.get("success", False),
            },
        }

    # Unknown method
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main():
    """Run the MCP server over stdio (Windows-compatible)."""
    import sys
    import os

    # Windows: force stdin to binary mode and disable buffering issues
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

    while True:
        try:
            line = sys.stdin.readline()
        except (OSError, IOError):
            break

        if not line:
            break

        line_str = line.strip()
        if not line_str:
            continue

        try:
            msg = json.loads(line_str)
        except json.JSONDecodeError:
            continue

        response = handle_message(msg)
        if response is not None:
            out = json.dumps(response) + "\n"
            sys.stdout.write(out)
            sys.stdout.flush()


if __name__ == "__main__":
    main()
