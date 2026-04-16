"""Basic tests for LandGod Gateway Python."""
import asyncio
import json
import pytest


def test_security_sign_tool_call():
    from landgod_gateway_server.security import generate_ed25519_keypair, sign_tool_call

    pub_pem, priv_key = generate_ed25519_keypair()
    binding = {
        "userId": "user-1",
        "clientId": "client-1",
        "connectionId": "conn-1",
        "sessionId": "session-1",
        "serverKeyId": "key-1",
    }
    meta = sign_tool_call("req-1", "test_tool", {"arg": "val"}, binding, priv_key)
    assert meta["schema_version"] == "1.0"
    assert meta["request_id"] == "req-1"
    assert "signature" in meta
    assert "nonce" in meta
    assert "body_sha256" in meta


def test_canonicalize_json():
    from landgod_gateway_server.security import _canonicalize_json
    result = _canonicalize_json({"b": 2, "a": 1})
    assert result == '{"a":1,"b":2}'


def test_memory_store():
    from landgod_gateway_server.store import MemoryStore

    async def _run():
        store = MemoryStore()
        await store.set_client("c1", {"name": "test"})
        assert await store.get_client("c1") == {"name": "test"}
        clients = await store.list_clients()
        assert len(clients) == 1
        await store.delete_client("c1")
        assert await store.get_client("c1") is None

        await store.set_token("tok1", {"device_name": "dev1", "active": True})
        assert (await store.get_token("tok1"))["active"] is True
        tokens = await store.list_tokens()
        assert len(tokens) == 1

    asyncio.run(_run())
