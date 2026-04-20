"""CLI entry point for landgod-gateway-py."""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import signal
import sys

PID_FILE = os.path.join(os.path.expanduser("~"), ".landgod-gateway", "python-gateway.pid")


def main():
    parser = argparse.ArgumentParser(prog="landgod-gateway-py", description="LandGod Gateway (Python)")
    sub = parser.add_subparsers(dest="command")

    start_p = sub.add_parser("start", help="Start the gateway")
    start_p.add_argument("--port", type=int, default=int(os.environ.get("LANDGOD_HTTP_PORT", "8081")), help="HTTP port")
    start_p.add_argument("--ws-port", type=int, default=int(os.environ.get("LANDGOD_WS_PORT", "8080")), help="WebSocket port")
    start_p.add_argument("--redis", type=str, default=None, help="Redis URL for cluster mode")
    start_p.add_argument("--token", type=str, default=None, help="Auth token (replaces default hardcoded-token-1234)")
    start_p.add_argument("--daemon", action="store_true", help="Run as background daemon")

    sub.add_parser("stop", help="Stop the gateway")
    sub.add_parser("status", help="Check gateway status")

    args = parser.parse_args()

    if args.command == "start":
        _start(args)
    elif args.command == "stop":
        _stop()
    elif args.command == "status":
        _status()
    else:
        parser.print_help()


def _start(args):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    if args.daemon:
        # Fork to background
        pid = os.fork()
        if pid > 0:
            # Parent
            os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)
            with open(PID_FILE, "w") as f:
                f.write(str(pid))
            print(f"Gateway started as daemon (PID {pid})")
            sys.exit(0)
        # Child continues
        os.setsid()

    # Write PID
    os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    from .gateway import Gateway

    gw = Gateway(
        ws_port=args.ws_port,
        http_port=args.port,
        redis_url=args.redis,
        auth_token=args.token,
    )

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def _shutdown(sig, frame):
        loop.call_soon_threadsafe(lambda: loop.create_task(_cleanup(gw)))

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    try:
        loop.run_until_complete(gw.run_forever())
    except KeyboardInterrupt:
        loop.run_until_complete(gw.stop())
    finally:
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass


async def _cleanup(gw):
    await gw.stop()
    try:
        os.unlink(PID_FILE)
    except OSError:
        pass
    asyncio.get_event_loop().stop()


def _stop():
    try:
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        os.kill(pid, signal.SIGTERM)
        print(f"Sent SIGTERM to PID {pid}")
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass
    except FileNotFoundError:
        print("Gateway is not running (no PID file)")
    except ProcessLookupError:
        print("Gateway process not found (stale PID file)")
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass


def _status():
    try:
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        # Check if process exists
        os.kill(pid, 0)
        print(f"Gateway is running (PID {pid})")
    except FileNotFoundError:
        print("Gateway is not running")
    except ProcessLookupError:
        print("Gateway is not running (stale PID file)")
        try:
            os.unlink(PID_FILE)
        except OSError:
            pass
    except ValueError:
        print("Invalid PID file")


if __name__ == "__main__":
    main()
