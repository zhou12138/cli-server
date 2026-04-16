"""State stores: MemoryStore (single-node) and RedisStore (cluster)."""
from __future__ import annotations

import json
import time
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class StateStore(Protocol):
    async def get_client(self, connection_id: str) -> dict | None: ...
    async def set_client(self, connection_id: str, info: dict) -> None: ...
    async def delete_client(self, connection_id: str) -> None: ...
    async def list_clients(self) -> list[dict]: ...
    async def get_token(self, token: str) -> dict | None: ...
    async def set_token(self, token: str, info: dict) -> None: ...
    async def list_tokens(self) -> list[dict]: ...
    async def close(self) -> None: ...


class MemoryStore:
    def __init__(self) -> None:
        self.clients: dict[str, dict] = {}
        self.tokens: dict[str, dict] = {}

    async def get_client(self, connection_id: str) -> dict | None:
        return self.clients.get(connection_id)

    async def set_client(self, connection_id: str, info: dict) -> None:
        self.clients[connection_id] = info

    async def delete_client(self, connection_id: str) -> None:
        self.clients.pop(connection_id, None)

    async def list_clients(self) -> list[dict]:
        return list(self.clients.values())

    async def get_token(self, token: str) -> dict | None:
        return self.tokens.get(token)

    async def set_token(self, token: str, info: dict) -> None:
        self.tokens[token] = info

    async def list_tokens(self) -> list[dict]:
        return [{"token_full": k, **v} for k, v in self.tokens.items()]

    async def close(self) -> None:
        pass


class RedisStore:
    CLIENT_PREFIX = "lgw:client:"
    TOKEN_PREFIX = "lgw:token:"
    CLIENT_TTL = 300  # 5 min, refreshed by heartbeat

    def __init__(self, redis_url: str) -> None:
        self._url = redis_url
        self._redis = None  # lazy init

    async def _get_redis(self):
        if self._redis is None:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(self._url, decode_responses=True)
        return self._redis

    async def get_client(self, connection_id: str) -> dict | None:
        r = await self._get_redis()
        data = await r.get(f"{self.CLIENT_PREFIX}{connection_id}")
        return json.loads(data) if data else None

    async def set_client(self, connection_id: str, info: dict) -> None:
        r = await self._get_redis()
        await r.set(f"{self.CLIENT_PREFIX}{connection_id}", json.dumps(info), ex=self.CLIENT_TTL)

    async def delete_client(self, connection_id: str) -> None:
        r = await self._get_redis()
        await r.delete(f"{self.CLIENT_PREFIX}{connection_id}")

    async def list_clients(self) -> list[dict]:
        r = await self._get_redis()
        keys = []
        async for key in r.scan_iter(f"{self.CLIENT_PREFIX}*"):
            keys.append(key)
        if not keys:
            return []
        values = await r.mget(*keys)
        return [json.loads(v) for v in values if v]

    async def get_token(self, token: str) -> dict | None:
        r = await self._get_redis()
        data = await r.get(f"{self.TOKEN_PREFIX}{token}")
        return json.loads(data) if data else None

    async def set_token(self, token: str, info: dict) -> None:
        r = await self._get_redis()
        await r.set(f"{self.TOKEN_PREFIX}{token}", json.dumps(info))

    async def list_tokens(self) -> list[dict]:
        r = await self._get_redis()
        keys = []
        async for key in r.scan_iter(f"{self.TOKEN_PREFIX}*"):
            keys.append(key)
        if not keys:
            return []
        values = await r.mget(*keys)
        result = []
        for key, val in zip(keys, values):
            if val:
                token_str = key.removeprefix(self.TOKEN_PREFIX)
                result.append({"token_full": token_str, **json.loads(val)})
        return result

    async def close(self) -> None:
        if self._redis:
            await self._redis.aclose()
