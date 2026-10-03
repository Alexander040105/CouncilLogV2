"""Unhandled exceptions must return a real 500 body that still carries CORS
headers. FastAPI's Exception handler lives in ServerErrorMiddleware — outside
CORSMiddleware — so without the inner catch-all a crash surfaces to browsers
as a CORS failure that hides the actual error.
"""
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.errors import UnhandledErrorMiddleware
from app.main import app


async def test_middleware_returns_500_body_for_crash():
    async def boom(scope, receive, send):
        raise RuntimeError("kaboom")

    sent = []

    async def send(msg):
        sent.append(msg)

    await UnhandledErrorMiddleware(boom)({"type": "http"}, None, send)

    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 500
    body = b"".join(m.get("body", b"") for m in sent
                    if m["type"] == "http.response.body")
    assert json.loads(body) == {"error": {"code": "INTERNAL_ERROR",
                                          "message": "Something went wrong"}}


async def test_middleware_passes_through_normal_responses():
    async def ok(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"hi"})

    sent = []

    async def send(msg):
        sent.append(msg)

    await UnhandledErrorMiddleware(ok)({"type": "http"}, None, send)
    assert sent[0]["status"] == 200
    assert sent[-1]["body"] == b"hi"


async def test_middleware_ignores_non_http_scopes():
    async def ws(scope, receive, send):
        raise RuntimeError("websocket crash")

    async def send(msg):
        pass

    with pytest.raises(RuntimeError):
        await UnhandledErrorMiddleware(ws)({"type": "websocket"}, None, send)


async def test_500_keeps_cors_headers_end_to_end():
    """Same middleware order as main.py: crash → 500 JSONResponse → passes
    back out through CORSMiddleware → Access-Control-Allow-Origin survives."""
    mini = FastAPI()
    mini.add_middleware(UnhandledErrorMiddleware)
    mini.add_middleware(CORSMiddleware, allow_origins=["https://web.example"])

    @mini.get("/boom")
    async def boom():
        raise RuntimeError("kaboom")

    transport = httpx.ASGITransport(app=mini)
    async with httpx.AsyncClient(transport=transport,
                                 base_url="http://test") as c:
        r = await c.get("/boom", headers={"Origin": "https://web.example"})
    assert r.status_code == 500
    assert r.headers["access-control-allow-origin"] == "https://web.example"
    assert r.json()["error"]["code"] == "INTERNAL_ERROR"


def test_cors_middleware_is_outermost():
    """Ordering guard: CORSMiddleware must wrap UnhandledErrorMiddleware —
    user_middleware[0] is the outermost (last registered)."""
    classes = [m.cls for m in app.user_middleware]
    assert classes.index(CORSMiddleware) < classes.index(UnhandledErrorMiddleware)
