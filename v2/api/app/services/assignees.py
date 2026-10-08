"""Multi-assignee helpers — the junction tables are the source of truth;
``assignee_id`` on the entity stays synced as the lead (first) assignee so
older clients keep working.
"""
import uuid

from sqlmodel import delete, select

from ..models import ChecklistItemAssignee, TaskAssignee

_MODEL = {"task": TaskAssignee, "checklist_item": ChecklistItemAssignee}
_FK = {"task": "task_id", "checklist_item": "item_id"}


def _fk(kind: str):
    return getattr(_MODEL[kind], _FK[kind])


def requested_assignees(body, fields_set: set) -> list[uuid.UUID] | None:
    """Deduped list the client asked for, or None when neither assignee
    field was sent. New-style ``assignee_ids`` wins over the legacy scalar."""
    if "assignee_ids" in fields_set:
        return list(dict.fromkeys(body.assignee_ids or []))
    if "assignee_id" in fields_set:
        return [body.assignee_id] if body.assignee_id else []
    return None


async def assignees_of(session, kind: str, entity_id: uuid.UUID) -> list[uuid.UUID]:
    rows = (await session.execute(
        select(_MODEL[kind]).where(_fk(kind) == entity_id))).scalars().all()
    return [r.user_id for r in rows]


async def assignee_map(session, kind: str, entity_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Bulk-load for list serialization: {entity_id: [user_id, …]}."""
    out = {eid: [] for eid in entity_ids}
    if not entity_ids:
        return out
    rows = (await session.execute(
        select(_MODEL[kind]).where(_fk(kind).in_(entity_ids)))).scalars().all()
    for r in rows:
        out[getattr(r, _FK[kind])].append(r.user_id)
    return out


async def set_assignees(session, kind: str, entity_id: uuid.UUID, ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Replace-all within the caller's transaction; returns the deduped list."""
    deduped = list(dict.fromkeys(ids))
    await session.execute(delete(_MODEL[kind]).where(_fk(kind) == entity_id))
    for uid in deduped:
        session.add(_MODEL[kind](**{_FK[kind]: entity_id, "user_id": uid}))
    return deduped
