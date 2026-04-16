"""HTTP API handler using aiohttp."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from aiohttp import web

logger = logging.getLogger("landgod.http")


def create_http_app(gateway) -> web.Application:
    app = web.Application()
    app["gw"] = gateway

    app.router.add_get("/health", health)
    app.router.add_get("/clients", clients)
    app.router.add_post("/tool_call", tool_call)
    app.router.add_post("/tokens", create_token)
    app.router.add_get("/tokens", list_tokens)
    app.router.add_delete("/tokens/{token}", revoke_token)

    return app


async def health(request: web.Request) -> web.Response:
    gw = request.app["gw"]
    tokens = await gw.store.list_tokens()
    all_clients = await gw.store.list_clients()
    return web.json_response({
        "status": "ok",
        "connectedClients": len(all_clients),
        "registeredTokens": len(tokens),
        "wsPort": gw.ws_port,
        "httpPort": gw.http_port,
    })


async def clients(request: web.Request) -> web.Response:
    gw = request.app["gw"]
    # For memory store, filter dead connections; for redis, trust TTL
    all_clients = await gw.store.list_clients()
    # Also include live local connections
    result = []
    seen = set()
    for cid, info in gw.ws_handler.connections.items():
        if info["ws"].protocol.state.name != "CLOSED" and info["binding"]:
            seen.add(cid)
            result.append({
                "connectionId": cid,
                "clientId": info["binding"]["clientId"],
                "clientName": info["binding"]["clientName"],
                "sessionId": info["binding"]["sessionId"],
                "connected": True,
            })
    # Add remote clients from store (cluster mode)
    for c in all_clients:
        if c.get("connectionId") not in seen:
            result.append(c)
    return web.json_response({"clients": result})


async def tool_call(request: web.Request) -> web.Response:
    gw = request.app["gw"]
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    tool_name = body.get("tool_name")
    if not tool_name:
        return web.json_response({"error": "Missing tool_name"}, status=400)

    arguments = body.get("arguments", {})
    timeout = body.get("timeout", 30000)
    connection_id = body.get("connection_id")
    client_name = body.get("clientName") or body.get("client_name") or (body.get("target", {}) or {}).get("clientName")

    try:
        if not connection_id and client_name:
            # Find by clientName locally first
            connection_id = gw.ws_handler.find_connection_by_client_name(client_name)
            if not connection_id:
                # In cluster mode, search store
                if gw.cluster:
                    all_clients = await gw.store.list_clients()
                    for c in all_clients:
                        if c.get("clientName") == client_name:
                            connection_id = c["connectionId"]
                            break
                if not connection_id:
                    return web.json_response({"error": f"No connected client named: {client_name}"}, status=404)

        if not connection_id:
            connection_id = gw.ws_handler.get_first_open_connection()
            if not connection_id:
                return web.json_response({"error": "No connected clients"}, status=404)

        # Route: try local, then cluster
        if gw.cluster:
            result = await gw.cluster.route_tool_call(connection_id, tool_name, arguments, timeout)
        else:
            result = await gw.ws_handler.send_tool_call(connection_id, tool_name, arguments, timeout)

        if result is None:
            return web.json_response({"error": "Client not reachable"}, status=502)

        return web.json_response(result)
    except TimeoutError as e:
        return web.json_response({"error": str(e)}, status=504)
    except Exception as e:
        logger.error(f"tool_call error: {e}")
        return web.json_response({"error": str(e)}, status=500)


async def create_token(request: web.Request) -> web.Response:
    gw = request.app["gw"]
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    device_name = body.get("device_name")
    if not device_name:
        return web.json_response({"error": "Missing device_name"}, status=400)

    token = f"tok_{uuid.uuid4().hex}"
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    await gw.store.set_token(token, {
        "device_name": device_name,
        "created_at": created_at,
        "active": True,
    })
    logger.info(f"[token] Created for {device_name}: {token[:12]}...")
    return web.json_response({"token": token, "device_name": device_name, "created_at": created_at}, status=201)


async def list_tokens(request: web.Request) -> web.Response:
    gw = request.app["gw"]
    tokens = await gw.store.list_tokens()
    result = []
    for t in tokens:
        full = t.get("token_full", "")
        result.append({
            "token": full[:12] + "..." if full else "",
            "token_full": full,
            "device_name": t.get("device_name", ""),
            "created_at": t.get("created_at", ""),
            "active": t.get("active", True),
        })
    return web.json_response({"tokens": result})


async def revoke_token(request: web.Request) -> web.Response:
    gw = request.app["gw"]
    token = request.match_info["token"]
    info = await gw.store.get_token(token)
    if not info:
        return web.json_response({"error": "Token not found"}, status=404)

    info["active"] = False
    await gw.store.set_token(token, info)

    # Disconnect clients using this token
    to_remove = []
    for cid, conn in gw.ws_handler.connections.items():
        if conn["token"] == token:
            to_remove.append(cid)
            try:
                await conn["ws"].close(4002, "Token revoked")
            except Exception:
                pass
    for cid in to_remove:
        gw.ws_handler.connections.pop(cid, None)
        await gw.store.delete_client(cid)
        logger.info(f"[token] Revoked and disconnected: {cid}")

    return web.json_response({"revoked": True, "token": token[:12] + "..."})
