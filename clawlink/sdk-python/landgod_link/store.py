"""
LandGod Link State Store — 状态存储抽象层

支持:
  - memory: 单机内存存储（默认）
  - redis:  分布式 Redis 存储

用法:
  store = create_store('memory')
  store = create_store('redis://localhost:6379')
"""

import json
import time
from typing import Optional, Any
from abc import ABC, abstractmethod


class StateStore(ABC):
    """状态存储抽象基类"""

    @abstractmethod
    def get(self, key: str) -> Optional[Any]:
        pass

    @abstractmethod
    def set(self, key: str, value: Any, ttl: int = 0) -> None:
        """ttl: 过期时间（秒），0 表示不过期"""
        pass

    @abstractmethod
    def delete(self, key: str) -> None:
        pass

    @abstractmethod
    def keys(self, pattern: str = '*') -> list:
        pass

    @abstractmethod
    def exists(self, key: str) -> bool:
        pass

    @abstractmethod
    def incr(self, key: str) -> int:
        pass

    @abstractmethod
    def lpush(self, key: str, value: Any) -> None:
        pass

    @abstractmethod
    def lrange(self, key: str, start: int, end: int) -> list:
        pass

    @abstractmethod
    def expire(self, key: str, ttl: int) -> None:
        pass


class MemoryStore(StateStore):
    """单机内存存储"""

    def __init__(self):
        self._data: dict = {}
        self._expiry: dict = {}
        self._lists: dict = {}

    def _check_expiry(self, key: str) -> bool:
        if key in self._expiry:
            if time.time() > self._expiry[key]:
                self._data.pop(key, None)
                self._expiry.pop(key, None)
                self._lists.pop(key, None)
                return True
        return False

    def get(self, key: str) -> Optional[Any]:
        self._check_expiry(key)
        return self._data.get(key)

    def set(self, key: str, value: Any, ttl: int = 0) -> None:
        self._data[key] = value
        if ttl > 0:
            self._expiry[key] = time.time() + ttl

    def delete(self, key: str) -> None:
        self._data.pop(key, None)
        self._expiry.pop(key, None)
        self._lists.pop(key, None)

    def keys(self, pattern: str = '*') -> list:
        import fnmatch
        # 清理过期
        for k in list(self._data.keys()):
            self._check_expiry(k)
        all_keys = set(list(self._data.keys()) + list(self._lists.keys()))
        if pattern == '*':
            return list(all_keys)
        return [k for k in all_keys if fnmatch.fnmatch(k, pattern)]

    def exists(self, key: str) -> bool:
        self._check_expiry(key)
        return key in self._data or key in self._lists

    def incr(self, key: str) -> int:
        self._check_expiry(key)
        val = self._data.get(key, 0)
        val = int(val) + 1
        self._data[key] = val
        return val

    def lpush(self, key: str, value: Any) -> None:
        if key not in self._lists:
            self._lists[key] = []
        self._lists[key].insert(0, value)

    def lrange(self, key: str, start: int, end: int) -> list:
        self._check_expiry(key)
        lst = self._lists.get(key, [])
        if end == -1:
            return lst[start:]
        return lst[start:end + 1]

    def expire(self, key: str, ttl: int) -> None:
        self._expiry[key] = time.time() + ttl


class RedisStore(StateStore):
    """分布式 Redis 存储"""

    def __init__(self, url: str = 'redis://localhost:6379'):
        try:
            import redis
        except ImportError:
            raise ImportError("Redis support requires 'redis' package. Install with: pip install redis")
        
        self._client = redis.from_url(url, decode_responses=True)
        self._prefix = 'landgod:'
        # 测试连接
        self._client.ping()

    def _key(self, key: str) -> str:
        return f'{self._prefix}{key}'

    def get(self, key: str) -> Optional[Any]:
        val = self._client.get(self._key(key))
        if val is None:
            return None
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return val

    def set(self, key: str, value: Any, ttl: int = 0) -> None:
        serialized = json.dumps(value) if not isinstance(value, (str, int, float)) else str(value)
        if ttl > 0:
            self._client.setex(self._key(key), ttl, serialized)
        else:
            self._client.set(self._key(key), serialized)

    def delete(self, key: str) -> None:
        self._client.delete(self._key(key))

    def keys(self, pattern: str = '*') -> list:
        full_pattern = f'{self._prefix}{pattern}'
        keys = self._client.keys(full_pattern)
        return [k.replace(self._prefix, '', 1) for k in keys]

    def exists(self, key: str) -> bool:
        return bool(self._client.exists(self._key(key)))

    def incr(self, key: str) -> int:
        return self._client.incr(self._key(key))

    def lpush(self, key: str, value: Any) -> None:
        serialized = json.dumps(value) if not isinstance(value, (str, int, float)) else str(value)
        self._client.lpush(self._key(key), serialized)

    def lrange(self, key: str, start: int, end: int) -> list:
        items = self._client.lrange(self._key(key), start, end)
        result = []
        for item in items:
            try:
                result.append(json.loads(item))
            except (json.JSONDecodeError, TypeError):
                result.append(item)
        return result

    def expire(self, key: str, ttl: int) -> None:
        self._client.expire(self._key(key), ttl)


def create_store(backend: str = 'memory') -> StateStore:
    """创建状态存储实例
    
    Args:
        backend: 'memory' 或 Redis URL (如 'redis://localhost:6379')
    """
    if backend == 'memory':
        return MemoryStore()
    elif backend.startswith('redis://') or backend.startswith('rediss://'):
        return RedisStore(backend)
    else:
        raise ValueError(f"Unknown store backend: {backend}. Use 'memory' or 'redis://...'")
