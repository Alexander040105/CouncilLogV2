"""Supabase Auth admin operations — service role, server-side only."""

import logging
import uuid

import httpx

from ..config import get_settings

log = logging.getLogger("councilog.auth_admin")

# ~100 years — effectively permanent, but still admin-reversible in Supabase
_BAN_DURATION = "876600h"


async def ban_user(user_id: uuid.UUID | str) -> bool:
    """Disable an auth user so they can't sign in or refresh a session."""
    s = get_settings()
    if not s.supabase_service_role_key or "placeholder" in s.supabase_service_role_key:
        log.info("no service key — skipped ban of %s", user_id)
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.put(
                f"{s.supabase_url}/auth/v1/admin/users/{user_id}",
                headers={"Authorization": f"Bearer {s.supabase_service_role_key}",
                         "apikey": s.supabase_service_role_key},
                json={"ban_duration": _BAN_DURATION},
            )
        if r.status_code == 200:
            return True
        log.error("ban_user %s failed: %s %s", user_id, r.status_code, r.text)
        return False
    except Exception:
        log.exception("ban_user %s failed", user_id)
        return False
