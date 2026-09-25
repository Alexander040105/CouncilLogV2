"""Supabase JWT verification.

Newer Supabase projects sign access tokens with asymmetric keys (ES256) —
verify via the project's JWKS endpoint. Legacy projects use HS256 with the
JWT secret. Supports both: JWKS first (cached), secret as fallback.
"""

import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

from .config import get_settings
from .errors import APIError


@dataclass
class AuthUser:
    id: str
    email: str | None
    claims: dict[str, Any]


_jwks_client: PyJWKClient | None = None
_jwks_fetched_at: float = 0
_JWKS_TTL = 3600


def _jwks() -> PyJWKClient | None:
    global _jwks_client, _jwks_fetched_at
    settings = get_settings()
    if _jwks_client is not None and time.time() - _jwks_fetched_at < _JWKS_TTL:
        return _jwks_client
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    try:
        resp = httpx.get(url, timeout=5)
        resp.raise_for_status()
        keys = resp.json().get("keys", [])
        if not keys:
            return None
        _jwks_client = PyJWKClient(url, lifespan=_JWKS_TTL)
        _jwks_fetched_at = time.time()
        return _jwks_client
    except Exception:
        return None


def verify_token(token: str) -> AuthUser:
    settings = get_settings()
    options = {"verify_aud": False}  # supabase aud='authenticated'; checked loosely below

    payload: dict[str, Any] | None = None
    client = _jwks()
    if client is not None:
        try:
            signing_key = client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256", "EdDSA"],
                options=options,
            )
        except jwt.PyJWTError:
            payload = None

    if payload is None and settings.supabase_jwt_secret:
        try:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                options=options,
            )
        except jwt.PyJWTError as e:
            raise APIError(401, "UNAUTHENTICATED", "Invalid or expired token") from e

    if payload is None:
        raise APIError(401, "UNAUTHENTICATED", "Invalid or expired token")

    aud = payload.get("aud")
    if aud not in ("authenticated", None):
        raise APIError(401, "UNAUTHENTICATED", "Invalid token audience")

    sub = payload.get("sub")
    if not sub:
        raise APIError(401, "UNAUTHENTICATED", "Token missing subject")

    return AuthUser(id=sub, email=payload.get("email"), claims=payload)
