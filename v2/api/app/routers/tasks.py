"""Freeform tasks — assignable to any member, linkable to projects,
documents, and journal entries. Assignment fan-out (inbox + email + push)
happens via fan_out_assignment."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import delete, select

from ..deps import Membership, Session, authorize, require_user_in_org
from ..errors import APIError, not_found
from ..models import (Document, JournalEntry, Organization, Profile, Project,
                      Task, TaskAssignee, TaskComment)
from ..pagination import envelope, page_params
from ..services.assignees import (assignee_map, assignees_of,
                                  requested_assignees, set_assignees)
from ..services.audit import audit
from ..services.idempotent import add_deduped, deduped_response
from ..services.notify import (fan_out_assignment, fan_out_progress,
                               push_to_user, record_notification)

router = APIRouter(tags=["tasks"])

STATUSES = ("open", "done", "cancelled")
PRIORITIES = ("low", "normal", "high")


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    assignee_id: uuid.UUID | None = None
    assignee_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)
    due_date: date | None = None
    priority: str = Field(default="normal", pattern="^(low|normal|high)$")
    project_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None
    journal_entry_id: uuid.UUID | None = None
    client_request_id: str | None = Field(default=None, max_length=64)


async def _check_links(session, org_id: uuid.UUID, body: TaskIn | TaskPatch):
    """Every linked entity must belong to this org — 404 otherwise (same
    privacy rule as documents/projects: cross-org ids are invisible)."""
    for model, key in ((Project, "project_id"), (Document, "document_id"),
                       (JournalEntry, "journal_entry_id")):
        ref = getattr(body, key, None)
        if ref is not None:
            row = await session.get(model, ref)
            if row is None or row.org_id != org_id:
                raise not_found(model.__tablename__.rstrip("s").replace("_", " "))


async def _get_task(session, org_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    t = await session.get(Task, task_id)
    if t is None or t.org_id != org_id:
        raise not_found("task")
    return t


def _can_edit(t: Task, member: Membership) -> bool:
    return str(t.creator_id) == member.user_id or member.at_least("owner")


@router.get("/orgs/{org_id}/tasks")
async def list_tasks(org_id: uuid.UUID, session: Session,
                     assignee: str | None = None, creator: str | None = None,
                     status: str | None = None,
                     project_id: uuid.UUID | None = None,
                     document_id: uuid.UUID | None = None,
                     journal_entry_id: uuid.UUID | None = None,
                     page: int = 1, pageSize: int = 20,
                     member: Membership = Depends(authorize())):
    page, page_size = page_params(page, pageSize)
    q = select(Task).where(Task.org_id == org_id)
    if assignee == "me":
        uid = uuid.UUID(member.user_id)
    elif assignee:
        uid = uuid.UUID(assignee)
    else:
        uid = None
    if uid:
        q = q.where(Task.id.in_(select(TaskAssignee.task_id).where(
            TaskAssignee.user_id == uid)))
    if creator == "me":
        q = q.where(Task.creator_id == uuid.UUID(member.user_id))
    elif creator:
        q = q.where(Task.creator_id == uuid.UUID(creator))
    if status:
        if status not in STATUSES:
            raise APIError(422, "BAD_STATUS", f"status must be one of {STATUSES}")
        q = q.where(Task.status == status)
    for col, val in ((Task.project_id, project_id), (Task.document_id, document_id),
                     (Task.journal_entry_id, journal_entry_id)):
        if val:
            q = q.where(col == val)
    total = (await session.execute(
        select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await session.execute(
        q.order_by(Task.status != "open", Task.due_date.asc().nulls_last(),
                   Task.created_at.desc())
         .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    amap = await assignee_map(session, "task", [t.id for t in rows])
    items = [{**t.model_dump(), "assignee_ids": amap[t.id]} for t in rows]
    return envelope(items, page, page_size, total)


@router.post("/orgs/{org_id}/tasks", status_code=201)
async def create_task(org_id: uuid.UUID, body: TaskIn, session: Session,
                      bg: BackgroundTasks,
                      member: Membership = Depends(authorize())):
    await _check_links(session, org_id, body)
    ids = requested_assignees(body, body.model_fields_set) or []
    for uid in ids:
        await require_user_in_org(session, org_id, str(uid))
    t = Task(org_id=org_id, creator_id=uuid.UUID(member.user_id),
             assignee_id=ids[0] if ids else None,
             **body.model_dump(exclude={"assignee_id", "assignee_ids"}))
    t, deduped = await add_deduped(
        session, t, Task, org_id=org_id, client_request_id=body.client_request_id)
    if deduped:
        return deduped_response(t)
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="task.created", entity_type="task", entity_id=t.id,
                metadata={"title": t.title})
    if ids:
        await set_assignees(session, "task", t.id, ids)
        for uid in ids:
            await fan_out_assignment(
                session, bg, org_id=org_id, actor_id=member.user_id, kind="task",
                title=t.title, assignee_id=uid,
                entity_type="task", entity_id=t.id)
    await session.commit()
    return {"data": {**t.model_dump(), "assignee_ids": ids}}


@router.get("/orgs/{org_id}/tasks/{task_id}")
async def get_task(org_id: uuid.UUID, task_id: uuid.UUID, session: Session,
                   member: Membership = Depends(authorize())):
    t = await _get_task(session, org_id, task_id)
    comments = (await session.execute(
        select(TaskComment).where(TaskComment.task_id == t.id)
        .order_by(TaskComment.created_at))).scalars().all()
    ids = await assignees_of(session, "task", t.id)
    return {"data": {**t.model_dump(), "assignee_ids": ids}, "comments": comments}


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    assignee_id: uuid.UUID | None = None      # explicit null unassigns
    assignee_ids: list[uuid.UUID] | None = None  # explicit [] unassigns all
    due_date: date | None = None              # explicit null clears
    priority: str | None = Field(default=None, pattern="^(low|normal|high)$")
    status: str | None = Field(default=None, pattern="^(open|done|cancelled)$")
    project_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None
    journal_entry_id: uuid.UUID | None = None


@router.patch("/orgs/{org_id}/tasks/{task_id}")
async def patch_task(org_id: uuid.UUID, task_id: uuid.UUID, body: TaskPatch,
                     session: Session, bg: BackgroundTasks,
                     member: Membership = Depends(authorize())):
    t = await _get_task(session, org_id, task_id)
    fields = set(body.model_fields_set)
    current = await assignees_of(session, "task", t.id)
    # an assignee's only write is flipping status open↔done
    status_only = fields <= {"status"}
    if not _can_edit(t, member):
        if not (status_only and member.user_id in {str(u) for u in current}
                and body.status in ("open", "done")):
            raise APIError(403, "FORBIDDEN",
                           "Only the creator, an owner, or an assignee "
                           "(status only) can edit this task")
    await _check_links(session, org_id, body)

    new_ids = requested_assignees(body, fields)
    if new_ids is not None and set(new_ids) != set(current):
        added = [u for u in new_ids if u not in set(current)]
        for uid in added:
            await require_user_in_org(session, org_id, str(uid))
        new_ids = await set_assignees(session, "task", t.id, new_ids)
        t.assignee_id = new_ids[0] if new_ids else None
        await audit(session, org_id=org_id, actor_id=member.user_id,
                    action="task.assigned" if new_ids else "task.unassigned",
                    entity_type="task", entity_id=t.id,
                    metadata={"assignee_ids": [str(u) for u in new_ids]})
        for uid in added:
            await fan_out_assignment(
                session, bg, org_id=org_id, actor_id=member.user_id, kind="task",
                title=t.title, assignee_id=uid,
                entity_type="task", entity_id=t.id)

    old_status = t.status
    for k, v in body.model_dump(exclude_unset=True).items():
        if k in ("assignee_id", "assignee_ids"):
            continue  # handled above (needs the member-check + notify)
        setattr(t, k, v)
    if body.status == "done" and old_status != "done":
        t.completed_by = uuid.UUID(member.user_id)
        t.completed_at = datetime.now(timezone.utc)
        await fan_out_progress(
            session, bg, org_id=org_id, actor_id=member.user_id,
            kind="task_done", user_id=t.creator_id,
            entity_type="task", entity_id=t.id, title=t.title,
            push_body=f'"{t.title}" is marked done')
    if body.status == "open":
        t.completed_by = None
        t.completed_at = None
    t.updated_at = datetime.now(timezone.utc)
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="task.updated", entity_type="task", entity_id=t.id,
                metadata={"fields": sorted(fields)})
    await session.commit()
    return {"data": {**t.model_dump(),
                     "assignee_ids": new_ids if new_ids is not None else current}}


@router.delete("/orgs/{org_id}/tasks/{task_id}")
async def delete_task(org_id: uuid.UUID, task_id: uuid.UUID, session: Session,
                      member: Membership = Depends(authorize())):
    t = await _get_task(session, org_id, task_id)
    if not _can_edit(t, member):
        raise APIError(403, "FORBIDDEN", "Only the creator or an owner can delete this task")
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="task.deleted", entity_type="task", entity_id=t.id,
                metadata={"title": t.title})
    await session.execute(
        delete(TaskAssignee).where(TaskAssignee.task_id == t.id))
    await session.delete(t)
    await session.commit()
    return {"ok": True}


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


@router.post("/orgs/{org_id}/tasks/{task_id}/comments", status_code=201)
async def add_comment(org_id: uuid.UUID, task_id: uuid.UUID, body: CommentIn,
                      session: Session, bg: BackgroundTasks,
                      member: Membership = Depends(authorize())):
    t = await _get_task(session, org_id, task_id)
    c = TaskComment(task_id=t.id, body=body.body,
                    author_id=uuid.UUID(member.user_id))
    session.add(c)
    # inbox + push for the assignee/creator — no email, a comment isn't worth one
    org = await session.get(Organization, org_id)
    actor = await session.get(Profile, uuid.UUID(member.user_id))
    by = actor.display_name if actor else "someone"
    current = await assignees_of(session, "task", t.id)
    targets = {x for x in (*current, t.creator_id) if x and str(x) != member.user_id}
    for target in targets:
        record_notification(session, org_id=org_id, user_id=target,
                            kind="task_commented",
                            payload={"entity_type": "task", "entity_id": str(t.id),
                                     "title": t.title, "by": by})
        bg.add_task(push_to_user, target,
                    title=f"{org.name if org else 'CounciLog'} · {by} commented",
                    body=t.title,
                    data={"entity_type": "task", "entity_id": str(t.id),
                          "kind": "task_commented"})
    await session.commit()
    return {"data": c}
