"""Multi-assignee tasks + checklist items.

The task_assignees / checklist_item_assignees junctions are the source of
truth; the single assignee_id column stays synced as the "lead" for old
clients. Same harness as test_tasks_notifications.py: handlers invoked
directly, sqlite in-memory, bare BackgroundTasks.
"""
import uuid
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlmodel import select


@compiles(JSONB, "sqlite")
def _jsonb_as_json(element, compiler, **kw):
    return "JSON"

from app.config import get_settings
from app.deps import Membership
from app.errors import APIError
from app.models import (AttendanceDay, AuditLog, ChecklistItemAssignee,
                        Document, DocumentSignatoryStep, DutySchedule,
                        Notification, OrgMember, Organization, Position,
                        Profile, Project, ProjectChecklistItem, PushToken,
                        RateLimit, SchoolYear, Task, TaskAssignee, TaskComment)
from app.pagination import org_today
from app.routers.internal import reminders
from app.routers.projects import (ChecklistItemPatch, list_checklist_items,
                                  patch_item)
from app.routers.tasks import (TaskIn, TaskPatch, create_task, get_task,
                               list_tasks, patch_task)

TABLES = (Organization.__table__, Profile.__table__, OrgMember.__table__,
          SchoolYear.__table__, DutySchedule.__table__, AttendanceDay.__table__,
          Position.__table__, Project.__table__,
          ProjectChecklistItem.__table__, ChecklistItemAssignee.__table__,
          Task.__table__, TaskAssignee.__table__, TaskComment.__table__,
          Document.__table__, DocumentSignatoryStep.__table__,
          Notification.__table__, PushToken.__table__, RateLimit.__table__,
          AuditLog.__table__)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in TABLES:
            for c in t.c:
                sd = c.server_default
                if sd is not None and "jsonb" in str(getattr(sd, "arg", sd)).lower():
                    c.server_default = None
            await conn.run_sync(t.create)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


def _member(org_id, uid, role="member") -> Membership:
    return Membership(org_id=org_id, user_id=str(uid), role=role)


async def _org(session):
    org = Organization(name="Council", slug=f"o-{uuid.uuid4().hex[:8]}",
                       created_by=uuid.uuid4())
    session.add(org)
    await session.flush()
    return org


async def _member_row(session, org_id, uid, role="member"):
    session.add(OrgMember(org_id=org_id, user_id=uid, role=role, status="active"))


def _bg():
    return BackgroundTasks()


async def _notifs(session, user_id=None, kind=None):
    q = select(Notification)
    if user_id:
        q = q.where(Notification.user_id == user_id)
    if kind:
        q = q.where(Notification.kind == kind)
    return (await session.execute(q)).scalars().all()


async def _task_junction(session, task_id):
    rows = (await session.execute(select(TaskAssignee).where(
        TaskAssignee.task_id == task_id))).scalars().all()
    return {r.user_id for r in rows}


# ── Tasks ────────────────────────────────────────────────────────────────

async def test_create_task_multi_assignee(session):
    org = await _org(session)
    creator, a, b = (uuid.uuid4() for _ in range(3))
    for uid in (a, b):
        await _member_row(session, org.id, uid)
    await session.flush()

    r = await create_task(org_id=org.id, session=session, bg=_bg(),
                          member=_member(org.id, creator),
                          body=TaskIn(title="Paint booth",
                                      assignee_ids=[a, a, b]))  # dup input dedupes
    d = r["data"]
    assert d["assignee_ids"] == [a, b]
    assert d["assignee_id"] == a            # lead = first, for old clients
    assert await _task_junction(session, d["id"]) == {a, b}
    # every assignee gets the assignment ping in the same transaction
    assert len(await _notifs(session, a, "assigned")) == 1
    assert len(await _notifs(session, b, "assigned")) == 1


async def test_multi_assignee_filter_and_status_flip(session):
    org = await _org(session)
    creator, a, b, rando = (uuid.uuid4() for _ in range(4))
    for uid in (a, b, rando):
        await _member_row(session, org.id, uid)
    await session.flush()
    r = await create_task(org_id=org.id, session=session, bg=_bg(),
                          member=_member(org.id, creator),
                          body=TaskIn(title="T", assignee_ids=[a, b]))
    tid = r["data"]["id"]

    # both assignees see it under "mine"
    for uid in (a, b):
        lst = await list_tasks(org_id=org.id, session=session, assignee="me",
                               member=_member(org.id, uid))
        assert tid in {x["id"] for x in lst["data"]}
    # the rando doesn't
    lst = await list_tasks(org_id=org.id, session=session, assignee="me",
                           member=_member(org.id, rando))
    assert tid not in {x["id"] for x in lst["data"]}
    # and get_task serializes the full set
    gt = await get_task(org_id=org.id, task_id=tid, session=session,
                        member=_member(org.id, rando))
    assert set(gt["data"]["assignee_ids"]) == {a, b}

    # a rando can't touch it; ANY assignee can flip status
    with pytest.raises(APIError) as e:
        await patch_task(org_id=org.id, task_id=tid, session=session, bg=_bg(),
                         member=_member(org.id, rando), body=TaskPatch(status="done"))
    assert e.value.status_code == 403
    r = await patch_task(org_id=org.id, task_id=tid, session=session, bg=_bg(),
                         member=_member(org.id, b), body=TaskPatch(status="done"))
    assert r["data"]["status"] == "done"
    # first-to-finish closes it for everyone — a's "done" view agrees
    await session.refresh((await session.execute(
        select(Task).where(Task.id == tid))).scalars().one())
    r = await patch_task(org_id=org.id, task_id=tid, session=session, bg=_bg(),
                         member=_member(org.id, a), body=TaskPatch(status="open"))
    assert r["data"]["status"] == "open"


async def test_patch_assignee_ids_replaces_and_only_pings_newcomers(session):
    org = await _org(session)
    creator, a, b, c = (uuid.uuid4() for _ in range(4))
    for uid in (a, b, c):
        await _member_row(session, org.id, uid)
    await session.flush()
    r = await create_task(org_id=org.id, session=session, bg=_bg(),
                          member=_member(org.id, creator),
                          body=TaskIn(title="T", assignee_ids=[a, b]))
    tid = r["data"]["id"]

    # b stays, a leaves, c joins → only c gets a fresh ping
    r = await patch_task(org_id=org.id, task_id=tid, session=session, bg=_bg(),
                         member=_member(org.id, creator),
                         body=TaskPatch(assignee_ids=[b, c]))
    assert r["data"]["assignee_ids"] == [b, c]
    assert r["data"]["assignee_id"] == b
    assert await _task_junction(session, tid) == {b, c}
    assert len(await _notifs(session, a, "assigned")) == 1   # the create-time one
    assert len(await _notifs(session, b, "assigned")) == 1   # not re-pinged
    assert len(await _notifs(session, c, "assigned")) == 1   # the new one

    # explicit empty = unassign all
    r = await patch_task(org_id=org.id, task_id=tid, session=session, bg=_bg(),
                         member=_member(org.id, creator),
                         body=TaskPatch(assignee_ids=[]))
    assert r["data"]["assignee_ids"] == [] and r["data"]["assignee_id"] is None
    assert await _task_junction(session, tid) == set()


async def test_legacy_scalar_assignee_still_works(session):
    org = await _org(session)
    creator, a, b = (uuid.uuid4() for _ in range(3))
    for uid in (a, b):
        await _member_row(session, org.id, uid)
    await session.flush()

    r = await create_task(org_id=org.id, session=session, bg=_bg(),
                          member=_member(org.id, creator),
                          body=TaskIn(title="T", assignee_id=a))
    tid = r["data"]["id"]
    assert r["data"]["assignee_ids"] == [a]

    # patch via the legacy scalar replaces the set
    r = await patch_task(org_id=org.id, task_id=tid, session=session, bg=_bg(),
                         member=_member(org.id, creator),
                         body=TaskPatch(assignee_id=b))
    assert r["data"]["assignee_ids"] == [b]
    assert await _task_junction(session, tid) == {b}

    # legacy explicit null unassigns
    r = await patch_task(org_id=org.id, task_id=tid, session=session, bg=_bg(),
                         member=_member(org.id, creator),
                         body=TaskPatch(assignee_id=None))
    assert r["data"]["assignee_ids"] == [] and r["data"]["assignee_id"] is None


async def test_multi_assignee_rejects_non_members(session):
    org = await _org(session)
    creator, a = uuid.uuid4(), uuid.uuid4()
    await _member_row(session, org.id, a)
    await session.flush()
    with pytest.raises(APIError) as e:
        await create_task(org_id=org.id, session=session, bg=_bg(),
                          member=_member(org.id, creator),
                          body=TaskIn(title="T",
                                      assignee_ids=[a, uuid.uuid4()]))
    assert e.value.code == "NOT_A_MEMBER"


# ── Checklist items ─────────────────────────────────────────────────────

async def test_checklist_item_multi_assignee(session):
    org = await _org(session)
    adviser, a, b, member = (uuid.uuid4() for _ in range(4))
    for uid in (a, b):
        await _member_row(session, org.id, uid)
    await _member_row(session, org.id, member, "officer")
    p = Project(org_id=org.id, title="Fair", owner_id=adviser)
    it = ProjectChecklistItem(org_id=org.id, project_id=p.id, ord=0, label="Venue")
    session.add_all([p, it])
    await session.flush()

    # adviser multi-assigns
    r = await patch_item(org_id=org.id, item_id=it.id,
                         body=ChecklistItemPatch(assignee_ids=[a, b]),
                         session=session, bg=_bg(),
                         member=_member(org.id, adviser, "adviser"))
    assert r["data"]["assignee_ids"] == [a, b]
    assert r["data"]["assignee_id"] == a
    assert len(await _notifs(session, a, "assigned")) == 1
    assert len(await _notifs(session, b, "assigned")) == 1

    # the flat "needs you" list finds it for BOTH
    for uid in (a, b):
        lst = await list_checklist_items(org_id=org.id, session=session,
                                         assignee_id=uid, done=False,
                                         member=_member(org.id, uid))
        assert it.id in {x["id"] for x in lst["data"]}

    # an officer can still only add/remove THEMSELVES
    m_member = _member(org.id, member, "officer")
    r = await patch_item(org_id=org.id, item_id=it.id,
                         body=ChecklistItemPatch(assignee_ids=[a, b, member]),
                         session=session, bg=_bg(), member=m_member)
    assert set(r["data"]["assignee_ids"]) == {a, b, member}
    with pytest.raises(APIError) as e:
        await patch_item(org_id=org.id, item_id=it.id,
                         body=ChecklistItemPatch(assignee_ids=[member]),
                         session=session, bg=_bg(), member=m_member)
    assert e.value.status_code == 403   # dropping a+b is someone else's patch


# ── Reminders fan-out ───────────────────────────────────────────────────

async def test_reminders_ping_every_assignee(session, monkeypatch):
    org = await _org(session)
    a, b = uuid.uuid4(), uuid.uuid4()
    tomorrow = org_today() + timedelta(days=1)
    t = Task(org_id=org.id, title="Print proposals", creator_id=a,
             assignee_id=a, due_date=tomorrow)
    session.add(t)
    await session.flush()
    session.add_all([TaskAssignee(task_id=t.id, user_id=a),
                     TaskAssignee(task_id=t.id, user_id=b)])
    await session.flush()
    monkeypatch.setattr(get_settings(), "cron_secret", "sekrit")

    r = await reminders(session=session, x_cron_secret="sekrit")
    assert r["data"]["sent"]["task_due_soon"] == 2
    assert len(await _notifs(session, a, "task_due_soon")) == 1
    assert len(await _notifs(session, b, "task_due_soon")) == 1

    # same-day rerun dedupes per user
    r = await reminders(session=session, x_cron_secret="sekrit")
    assert r["data"]["sent"]["task_due_soon"] == 0
