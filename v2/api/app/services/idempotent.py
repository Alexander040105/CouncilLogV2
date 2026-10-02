"""Idempotent creates for offline replay.

When a mobile client queues a mutation offline it generates a
client_request_id; the (org_id, client_request_id) unique constraint makes
a retried send a no-op instead of a duplicate. The deduped response
returns the existing row so the client can reconcile its temp id.
"""

import uuid

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlmodel import select


async def add_deduped(session, obj, model, *, org_id: uuid.UUID,
                      client_request_id: str | None):
    """Check-then-insert: a replayed client_request_id returns the original
    row instead of creating a duplicate.

    Pre-check rather than catch-IntegrityError: a flush failure inside a
    savepoint still poisons the session transaction (PendingRollbackError),
    and rollback() expires every loaded object. A true concurrent same-key
    race is still backstopped by the unique constraint → 409, which is
    acceptable — offline replay is sequential by design.
    Returns (row, deduplicated)."""
    if client_request_id:
        existing = (await session.execute(
            select(model).where(model.org_id == org_id,
                                model.client_request_id == client_request_id))
        ).scalars().first()
        if existing is not None:
            return existing, True
    session.add(obj)
    await session.flush()
    return obj, False


def deduped_response(row, extra: dict | None = None) -> JSONResponse:
    """Replay hit: 200 (not 201) with the existing row + a flag clients can
    key their temp-id reconciliation on."""
    return JSONResponse(status_code=200, content=jsonable_encoder(
        {"data": row, "deduplicated": True, **(extra or {})}))
