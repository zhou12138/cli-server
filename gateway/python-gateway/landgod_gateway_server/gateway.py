"""Core Gateway class - orchestrates WS, HTTP, store, and cluster."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid

import websockets
from aiohttp import web

from .security import generate_ed25519_keypair
from .store import MemoryStore, RedisStore
from .ws_handler import WSHandler
from .http_handler import create_http_app
from .cluster import ClusterCoordinator

logger = logging.getLogger("landgod.gateway")


class Gateway:
    def __init__(
        self,
        ws_port: int = 8080,
        http_port: int = 8081,
        redis_url: str | None = None,
        auth_token: str | None = None,
        data_dir: str | None = None,
    ) -> None:
        self.ws_port = ws_port
        self.http_port = http_port
        self.redis_url = redis_url
        self.auth_token = auth_token or os.environ.get("LANDGOD_AUTH_TOKEN", "hardcoded-token-1234")
        self.data_dir = data_dir or os.path.join(os.path.expanduser("~"), ".landgod-gateway")
        self.node_id = f"node-{uuid.uuid4().hex[:8]}"

        # Ed25519 keypair
        self.public_key_pem, self.private_key = generate_ed25519_keypair()
        logger.info("Server Ed25519 key pair generated.")

        # Store
        if redis_url:
            self.store = RedisStore(redis_url)
        else:
            self.store = MemoryStore()

        # WS handler
        self.ws_handler = WSHandler(self)

        # Cluster
        self.cluster: ClusterCoordinator | None = None
        if redis_url:
            self.cluster = ClusterCoordinator(redis_url, self.node_id)

        # Load legacy tokens
        self._load_tokens()

    def _load_tokens(self) -> None:
        """Load tokens from disk (memory store only, for backward compat)."""
        if not isinstance(self.store, MemoryStore):
            return
        token_file = os.path.join(self.data_dir, "tokens.json")
        os.makedirs(self.data_dir, exist_ok=True)
        try:
            with open(token_file) as f:
                tokens = json.load(f)
            for k, v in tokens.items():
                self.store.tokens[k] = v
            logger.info(f"Loaded {len(self.store.tokens)} tokens from {token_file}")
        except FileNotFoundError:
            logger.info("No token file found, using configured auth token")
        # Always ensure the current auth_token is registered
        self.store.tokens[self.auth_token] = {"device_name": "*", "created_at": "legacy", "active": True}
        # Remove old hardcoded token if a custom token is set
        if self.auth_token != "hardcoded-token-1234" and "hardcoded-token-1234" in self.store.tokens:
            del self.store.tokens["hardcoded-token-1234"]
            logger.info("Removed default hardcoded-token-1234 (custom token configured)")

    def _save_tokens(self) -> None:
        if isinstance(self.store, MemoryStore):
            token_file = os.path.join(self.data_dir, "tokens.json")
            with open(token_file, "w") as f:
                json.dump(self.store.tokens, f, indent=2)

    async def is_valid_token(self, token: str) -> bool:
        if not token:
            return False
        if token == self.auth_token:
            return True
        info = await self.store.get_token(token)
        return info is not None and info.get("active", False)

    async def start(self) -> None:
        """Start the gateway (WS + HTTP servers)."""
        # Start cluster if configured
        if self.cluster:
            await self.cluster.start(self.ws_handler.send_tool_call)

        # Start WebSocket server
        self._ws_server = await websockets.serve(
            self.ws_handler.handle,
            "0.0.0.0",
            self.ws_port,
            ping_interval=None,  # we handle pings ourselves
        )
        logger.info(f"WebSocket server running at ws://0.0.0.0:{self.ws_port}")

        # Start HTTP server
        self._http_app = create_http_app(self)
        self._http_runner = web.AppRunner(self._http_app)
        await self._http_runner.setup()
        site = web.TCPSite(self._http_runner, "0.0.0.0", self.http_port)
        await site.start()
        logger.info(f"HTTP API server running at http://0.0.0.0:{self.http_port}")
        logger.info("")
        logger.info("=== API Endpoints ===")
        logger.info("GET  /health      - 健康检查")
        logger.info("GET  /clients     - 列出已连接的客户端")
        logger.info("POST /tool_call   - 发送工具调用")
        logger.info("POST /tokens      - 创建 Token")
        logger.info("GET  /tokens      - 列出 Token")
        logger.info("DELETE /tokens/:t - 吊销 Token")

    async def stop(self) -> None:
        if self.cluster:
            await self.cluster.stop()
        self._ws_server.close()
        await self._ws_server.wait_closed()
        await self._http_runner.cleanup()
        await self.store.close()
        self._save_tokens()
        logger.info("Gateway stopped.")

    async def run_forever(self) -> None:
        await self.start()
        try:
            await asyncio.Future()  # run forever
        except asyncio.CancelledError:
            pass
        finally:
            await self.stop()
