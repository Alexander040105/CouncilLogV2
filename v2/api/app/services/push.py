"""Expo push notifications via the Expo push API.

Devices register their Expo push token via POST /orgs/{o}/push-tokens;
this service batches one send per notification event. Best-effort like
email — failures are logged, never raised, and a user with no registered
devices is a quiet no-op.
"""

import logging
import uuid

import httpx
from sqlmodel import select

from ..models import PushToken

log = logging.getLogger("councilog.push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_push(session, user_id: uuid.UUID | str, *, title: str,
                    body: str, data: dict | None = None) -> bool:
    """Push to every device the user has registered. Returns False silently
    when they have none — that's a user without the app, not an error."""
    tokens = (await session.execute(
        select(PushToken).where(PushToken.user_id == uuid.UUID(str(user_id))))
    ).scalars().all()
    if not tokens:
        return False
    messages = [{"to": t.token, "title": title, "body": body,
                 "sound": "default", "data": data or {}} for t in tokens]
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(EXPO_PUSH_URL, json=messages, headers={
                "accept": "application/json", "content-type": "application/json"})
        if r.status_code != 200:
            log.warning("expo push rejected: %s %s", r.status_code, r.text[:200])
            return False
        # Ticket receipts come back in message order — prune dead devices
        # (uninstalled / permissions revoked) so we stop hammering them.
        tickets = r.json().get("data") or []
        for t, ticket in zip(tokens, tickets):
            if (ticket or {}).get("status") == "error" and \
                    (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                await session.delete(t)
        return True
    except Exception:
        log.exception("expo push failed for user %s", user_id)
        return False
