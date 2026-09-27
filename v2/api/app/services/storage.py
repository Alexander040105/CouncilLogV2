"""Supabase Storage signed-URL minting via the service key (REST).

Upload:  POST {url}/storage/v1/object/upload/sign/{bucket}/{path}
         → { "url": "object/upload/sign/.../token" } (client PUTs bytes)
Download: POST {url}/storage/v1/object/sign/{bucket}/{path}
         body {"expiresIn": seconds} → { "signedURL": "..." }
"""

import logging

import httpx

from ..config import get_settings
from ..errors import APIError

log = logging.getLogger("councilog.storage")

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024

_MAGIC = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/webp": b"RIFF",
}


def validate_upload_declared(mime: str, byte_size: int) -> None:
    if mime not in ALLOWED_MIME:
        raise APIError(422, "BAD_FILE_TYPE", "Only jpeg/png/webp images are allowed")
    if byte_size <= 0 or byte_size > MAX_BYTES:
        raise APIError(422, "FILE_TOO_LARGE", "Image must be ≤ 5MB")


def check_magic_bytes(head: bytes, declared_mime: str) -> bool:
    sig = _MAGIC.get(declared_mime)
    return sig is not None and head.startswith(sig)


def _headers() -> dict:
    key = get_settings().supabase_service_role_key
    return {"Authorization": f"Bearer {key}", "apikey": key}


def _base() -> str:
    return f"{get_settings().supabase_url.rstrip('/')}/storage/v1"


async def signed_upload_url(path: str, bucket: str | None = None) -> str:
    bucket = bucket or get_settings().storage_bucket
    async with httpx.AsyncClient() as c:
        r = await c.post(
            f"{_base()}/object/upload/sign/{bucket}/{path}",
            headers=_headers(),
            timeout=10,
        )
        if r.status_code >= 400:
            raise APIError(502, "STORAGE_ERROR", "Could not mint upload URL")
        body = r.json()
        token_path = body.get("url") or body.get("signedURL") or ""
        return f"{_base()}/{token_path.lstrip('/')}"


async def signed_download_url(path: str) -> str:
    bucket = get_settings().storage_bucket
    ttl = get_settings().signed_url_ttl_seconds
    async with httpx.AsyncClient() as c:
        r = await c.post(
            f"{_base()}/object/sign/{bucket}/{path}",
            headers=_headers(),
            json={"expiresIn": ttl},
            timeout=10,
        )
        if r.status_code >= 400:
            raise APIError(404, "NOT_FOUND", "File not found")
        body = r.json()
        signed = body.get("signedURL") or body.get("signedUrl") or ""
        return f"{_base()}/{signed.lstrip('/')}"


def public_object_url(path: str, bucket: str | None = None) -> str:
    """Plain GET URL — only usable for public buckets (e.g. avatars)."""
    bucket = bucket or get_settings().storage_bucket
    return f"{_base()}/object/public/{bucket}/{path}"


async def object_head(path: str) -> bytes | None:
    """Fetch first bytes of an object for magic-byte verification."""
    bucket = get_settings().storage_bucket
    async with httpx.AsyncClient() as c:
        r = await c.get(
            f"{_base()}/object/{bucket}/{path}",
            headers={**_headers(), "Range": "bytes=0-15"},
            timeout=10,
        )
        if r.status_code >= 400:
            return None
        return r.content[:16]


async def delete_object(path: str, bucket: str | None = None) -> None:
    """Best-effort object removal — never raises."""
    bucket = bucket or get_settings().storage_bucket
    try:
        async with httpx.AsyncClient() as c:
            r = await c.delete(f"{_base()}/object/{bucket}/{path}", headers=_headers(), timeout=10)
            if r.status_code >= 400:
                log.warning("delete %s/%s failed: %s", bucket, path, r.status_code)
    except Exception:
        log.warning("delete %s/%s failed", bucket, path)
