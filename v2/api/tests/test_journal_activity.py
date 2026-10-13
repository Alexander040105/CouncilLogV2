"""Journals↔tasks activity surface: dailies can tag a task (journal_entries.
task_id), members comment on each other's logs, and org owners set accent/brand
colors that ride on top of each member's own theme.

Also covers the set_assignees race fix — re-syncing the same set must be a
no-op, not a duplicate-key error.

Same harness as test_journal_paper_link.py: direct handlers, sqlite, bare
BackgroundTasks.
"""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlmodel import select


@compiles(JSONB, "sqlite")
def _jsonb_as_json(element, compiler, **kw):
    return "JSON"

from fastapi import BackgroundTasks

from app.deps import Membership, authorize
from app.errors import APIError
from app.security import AuthUser
from app.models import (AttendanceDay, AuditLog, Document, DutySchedule,
                        JournalEntry, JournalEntryComment, JournalPhoto,
                        Notification, OrgMember, Organization, Profile,
                        Project, SchoolYear, Task, TaskAssignee)
from app.routers.daily import (EntryIn, EntryPatch, JournalCommentIn,
                               add_entry_comment, create_entry, feed,
                               list_entry_comments, patch_entry)
from app.routers.orgs import OrgPatch, get_org, patch_org
from app.services.assignees import set_assignees

TABLES = (Organization.__table__, Profile.__table__, OrgMember.__table__,
          SchoolYear.__table__, DutySchedule.__table__, AttendanceDay.__table__,
          Project.__table__, Document.__table__, Task.__table__,
          TaskAssignee.__table__, JournalEntry.__table__,
          JournalEntryComment.__table__, JournalPhoto.__table__,
          Notification.__table__, AuditLog.__table__)


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


async def _org(session, name="Council"):
    org = Organization(name=name, slug=f"o-{uuid.uuid4().hex[:8]}",
                       created_by=uuid.uuid4())
    session.add(org)
    await session.flush()
    return org


async def _task(session, org_id, project_id=None, title="Chase registrar"):
    t = Task(org_id=org_id, title=title, creator_id=uuid.uuid4(),
             project_id=project_id)
    session.add(t)
    await session.flush()
    return t


async def _entries(session, org_id, **kw):
    return (await feed(org_id=org_id, session=session,
                       member=_member(org_id, uuid.uuid4()), **kw))["data"]


# ── journal.task_id ──────────────────────────────────────────────────────
async def test_entry_tagging_task_inherits_its_project(session):
    org = await _org(session)
    writer = uuid.uuid4()
    p = Project(org_id=org.id, title="Fair")
    session.add(p)
    await session.flush()
    task = await _task(session, org.id, project_id=p.id)

    r = await create_entry(org_id=org.id, session=session,
                           member=_member(org.id, writer),
                           body=EntryIn(description="Picked up forms",
                                        task_id=task.id))
    e = r["data"]
    assert e.task_id == task.id
    assert e.project_id == p.id     # inherited — task work IS project work


async def test_task_project_mismatch_rejected(session):
    org = await _org(session)
    pa, pb = (Project(org_id=org.id, title="A"), Project(org_id=org.id, title="B"))
    session.add_all([pa, pb])
    await session.flush()
    task = await _task(session, org.id, project_id=pa.id)

    with pytest.raises(APIError) as e:
        await create_entry(org_id=org.id, session=session,
                           member=_member(org.id, uuid.uuid4()),
                           body=EntryIn(description="x", project_id=pb.id,
                                        task_id=task.id))
    assert e.value.code == "TASK_PROJECT_MISMATCH"
    assert e.value.status_code == 422


async def test_task_from_another_org_is_404(session):
    org, other = await _org(session), await _org(session)
    task = await _task(session, other.id)

    with pytest.raises(APIError) as e:
        await create_entry(org_id=org.id, session=session,
                           member=_member(org.id, uuid.uuid4()),
                           body=EntryIn(description="x", task_id=task.id))
    assert e.value.status_code == 404


async def test_task_filter_and_feed_enrichment(session):
    org = await _org(session)
    writer = uuid.uuid4()
    m = _member(org.id, writer)
    task, other = await _task(session, org.id), await _task(session, org.id, title="Else")

    on_task = (await create_entry(org_id=org.id, session=session, member=m,
                                  body=EntryIn(description="Did the thing",
                                               task_id=task.id)))["data"]
    off_task = (await create_entry(org_id=org.id, session=session, member=m,
                                   body=EntryIn(description="Elsewhere",
                                                task_id=other.id)))["data"]
    plain = (await create_entry(org_id=org.id, session=session, member=m,
                                body=EntryIn(description="No task")))["data"]

    # ?task_id= zooms to one task's dailies; rows carry the chip fields
    rows = await _entries(session, org.id, task_id=task.id)
    assert {r["id"] for r in rows} == {on_task.id}
    assert rows[0]["task_title"] == "Chase registrar"
    assert rows[0]["comment_count"] == 0

    feed_ids = {r["id"] for r in await _entries(session, org.id)}
    assert {on_task.id, off_task.id, plain.id} <= feed_ids

    # a project feed sees dailies through the task link too
    p = Project(org_id=org.id, title="Fair")
    session.add(p)
    await session.flush()
    task.project_id = p.id
    await session.flush()
    ids = {r["id"] for r in await _entries(session, org.id, project_id=p.id)}
    assert on_task.id in ids


async def test_patch_task_id_is_tri_state(session):
    org = await _org(session)
    writer = uuid.uuid4()
    m = _member(org.id, writer)
    task, task2 = await _task(session, org.id), await _task(session, org.id)

    r = await create_entry(org_id=org.id, session=session, member=m,
                           body=EntryIn(description="x", task_id=task.id))
    eid = r["data"].id

    r = await patch_entry(org_id=org.id, entry_id=eid, session=session,
                          member=m, body=EntryPatch(description="y"))
    assert r["data"].task_id == task.id                     # absent → untouched
    r = await patch_entry(org_id=org.id, entry_id=eid, session=session,
                          member=m, body=EntryPatch(task_id=task2.id))
    assert r["data"].task_id == task2.id                    # set → swapped
    r = await patch_entry(org_id=org.id, entry_id=eid, session=session,
                          member=m, body=EntryPatch(task_id=None))
    assert r["data"].task_id is None                        # null → cleared


# ── comments on dailies ──────────────────────────────────────────────────
async def test_entry_comments_list_post_notify(session):
    org = await _org(session)
    author, commenter = uuid.uuid4(), uuid.uuid4()
    session.add(Profile(id=commenter, display_name="Jo"))
    await session.flush()
    e = (await create_entry(org_id=org.id, session=session,
                            member=_member(org.id, author),
                            body=EntryIn(description="Filed the letter")))["data"]

    bg = BackgroundTasks()
    await add_entry_comment(org_id=org.id, entry_id=e.id, session=session, bg=bg,
                            member=_member(org.id, commenter),
                            body=JournalCommentIn(body="Nice — I'll countersign."))
    # author's own comment doesn't self-notify
    await add_entry_comment(org_id=org.id, entry_id=e.id, session=session, bg=BackgroundTasks(),
                            member=_member(org.id, author),
                            body=JournalCommentIn(body="Thanks!"))

    rows = (await list_entry_comments(org_id=org.id, entry_id=e.id, session=session,
                                      member=_member(org.id, uuid.uuid4())))["data"]
    assert [r["body"] for r in rows] == ["Nice — I'll countersign.", "Thanks!"]
    assert rows[0]["author_name"] == "Jo"

    notes = (await session.execute(select(Notification).where(
        Notification.kind == "journal_commented"))).scalars().all()
    assert len(notes) == 1 and notes[0].user_id == author

    # count lands on the feed row
    row = next(r for r in await _entries(session, org.id) if r["id"] == e.id)
    assert row["comment_count"] == 2


async def test_comment_on_other_orgs_entry_is_404(session):
    org, other = await _org(session), await _org(session)
    e = (await create_entry(org_id=other.id, session=session,
                            member=_member(other.id, uuid.uuid4()),
                            body=EntryIn(description="x")))["data"]
    with pytest.raises(APIError) as err:
        await add_entry_comment(org_id=org.id, entry_id=e.id, session=session,
                                bg=BackgroundTasks(), member=_member(org.id, uuid.uuid4()),
                                body=JournalCommentIn(body="hi"))
    assert err.value.status_code == 404


# ── org theme ────────────────────────────────────────────────────────────
async def test_org_theme_roundtrip_and_validation(session):
    org = await _org(session)
    owner, rando = uuid.uuid4(), uuid.uuid4()
    om = _member(org.id, owner, role="owner")
    mm = _member(org.id, rando)

    r = await patch_org(org_id=org.id, body=OrgPatch(
        theme={"preset": "forest", "accent": "#123456"}), session=session, member=om)
    assert r["data"].theme_json == {"preset": "forest", "accent": "#123456"}

    shown = await get_org(org_id=org.id, session=session, member=mm)
    assert shown["data"].theme_json == {"preset": "forest", "accent": "#123456"}

    # members can't set it — the handler is gated by authorize("owner")
    # (dependency-level check, same as test_admin.py's min-role coverage)
    session.add(Profile(id=rando, display_name="Member"))
    session.add(OrgMember(org_id=org.id, user_id=rando, role="member",
                          status="active"))
    await session.flush()
    dep = authorize("owner")
    with pytest.raises(APIError) as e:
        await dep(org_id=org.id, session=session,
                  user=AuthUser(id=str(rando), email="m@example.com", claims={}),
                  x_org_id=None)
    assert e.value.status_code == 403

    # {} clears back to default
    r = await patch_org(org_id=org.id, body=OrgPatch(theme={}),
                        session=session, member=om)
    assert r["data"].theme_json is None


@pytest.mark.parametrize("bad", [
    {"accent": "red"},                       # not a #RRGGBB hex
    {"accent": "#12345"},                    # short hex
    {"preset": "neon"},                      # unknown preset
    {"surface": "#ffffff"},                  # unknown key — surfaces stay user's
])
async def test_org_theme_rejects_bad_input(session, bad):
    org = await _org(session)
    with pytest.raises(Exception):
        await patch_org(org_id=org.id, body=OrgPatch(theme=bad),
                        session=session,
                        member=_member(org.id, uuid.uuid4(), role="owner"))


# ── assignee sync is idempotent (the dup-key race fix) ───────────────────
async def test_set_assignees_repeat_sync_is_a_noop(session):
    org = await _org(session)
    task = await _task(session, org.id)
    a, b, c = (uuid.uuid4() for _ in range(3))

    await set_assignees(session, "task", task.id, [a, b])
    await session.flush()
    # the exact race from the screenshot: same set written again → no 23505
    out = await set_assignees(session, "task", task.id, [a, b])
    assert set(out) == {a, b}
    rows = (await session.execute(select(TaskAssignee).where(
        TaskAssignee.task_id == task.id))).scalars().all()
    assert len(rows) == 2

    # diff: only removed goes, only added inserts
    await set_assignees(session, "task", task.id, [b, c])
    await session.flush()
    got = {r.user_id for r in (await session.execute(
        select(TaskAssignee).where(TaskAssignee.task_id == task.id))).scalars().all()}
    assert got == {b, c}
