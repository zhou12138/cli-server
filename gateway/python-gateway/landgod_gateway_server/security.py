"""Ed25519 signing and verification for tool_call security binding."""
from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization


def generate_ed25519_keypair() -> tuple[str, Ed25519PrivateKey]:
    """Generate Ed25519 key pair, return (public_key_pem, private_key_obj)."""
    private_key = Ed25519PrivateKey.generate()
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return public_pem, private_key


def _sort_json_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_sort_json_value(v) for v in value]
    if isinstance(value, dict):
        return {k: _sort_json_value(v) for k, v in sorted(value.items())}
    return value


def _canonicalize_json(value: Any) -> str:
    return json.dumps(_sort_json_value(value), separators=(",", ":"), ensure_ascii=False)


def _to_base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _compute_body_sha256(tool_name: str, arguments: Any) -> str:
    canonical = _canonicalize_json({"tool_name": tool_name, "arguments": arguments})
    return _to_base64url(hashlib.sha256(canonical.encode()).digest())


def sign_tool_call(
    request_id: str,
    tool_name: str,
    arguments: Any,
    binding: dict,
    private_key: Ed25519PrivateKey,
) -> dict:
    """Sign a tool_call and return the meta dict (compatible with Node.js gateway)."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=60)
    nonce = str(uuid.uuid4())
    body_sha256 = _compute_body_sha256(tool_name, arguments)

    meta = {
        "schema_version": "1.0",
        "request_id": request_id,
        "user_id": binding["userId"],
        "client_id": binding["clientId"],
        "connection_id": binding["connectionId"],
        "session_id": binding["sessionId"],
        "key_id": binding["serverKeyId"],
        "nonce": nonce,
        "body_sha256": body_sha256,
        "iat": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "exp": exp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }

    sig_payload = {
        "schema_version": meta["schema_version"],
        "request_id": request_id,
        "session_id": meta["session_id"],
        "connection_id": meta["connection_id"],
        "user_id": meta["user_id"],
        "client_id": meta["client_id"],
        "iat": meta["iat"],
        "exp": meta["exp"],
        "nonce": nonce,
        "tool_name": tool_name,
        "arguments": arguments,
    }

    sig_bytes = private_key.sign(_canonicalize_json(sig_payload).encode())
    meta["signature"] = _to_base64url(sig_bytes)
    return meta
