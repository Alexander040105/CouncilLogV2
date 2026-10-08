"""Tasks + notifications + push tokens + offline-replay idempotency.

Same harness as test_daily_edits.py: handlers invoked directly with a
constructed Membership, sqlite in-memory. BackgroundTasks is instantiated
bare — bg.add_task collects the callable but nothing awaits it, so email
and push never fire here (they're verified separately by their own no-op
guards: placeholder service key / no tokens).
"""
import uuid
from datetime import datetime, timedelta, timezone

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
                        ChecklistTemplate, Document,
                        DocumentMovement, DocumentRevision, DocumentSignatoryStep,
                        DutySchedule, JoinRequest, JournalEntry, Notification,
                        OrgMember, Organization, Position, Profile, Project,
                        ProjectChecklistItem, PushToken, RateLimit, SchoolYear,
                        SignatoryChain, SignatoryStep, Task, TaskAssignee,
                        TaskComment)
from app.pagination import org_today
from app.routers.daily import EntryIn, create_entry
from app.routers.documents import (DocIn, MovementIn, StepAdvance, add_movement,
                                   advance_step, create_document,
                                   list_documents)
from app.routers.internal import reminders
from app.routers.notifications import (MarkRead, TokenDelete, TokenIn,
                                       delete_push_token, list_notifications,
                                       mark_all_read, mark_read,
                                       register_push_token)
from app.routers.orgs import DecideBody, JoinReqCreate, decide_join, request_join
from app.routers.projects import (ChecklistItemPatch, ProjectIn, ProjectPatch,
                                  create_project, patch_item, patch_project)
from app.routers.tasks import (CommentIn, TaskIn, TaskPatch, add_comment,
                               create_task, delete_task, get_task, list_tasks,
                               patch_task)
from app.security import AuthUser

TABLES = (Organization.__table__, Profile.__table__, OrgMember.__table__,
          SchoolYear.__table__, DutySchedule.__table__, AttendanceDay.__table__,
          Project.__table__, ProjectChecklistItem.__table__,
          ChecklistTemplate.__table__, Document.__table__,
          SignatoryChain.__table__, SignatoryStep.__table__,
          DocumentSignatoryStep.__table__, DocumentMovement.__table__,
          JournalEntry.__table__, Task.__table__, TaskComment.__table__,
          TaskAssignee.__table__, ChecklistItemAssignee.__table__,
          DocumentRevision.__table__, JoinRequest.__table__, Position.__table__,
          RateLimit.__table__,
          Notification.__table__, PushToken.__table__, AuditLog.__table__)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in TABLES:
            for c in t.c:
                sd = c.server_default
                if sd is not None and "jsonb" in str(getattr(sd, "arg", sd)).lower():
                    c.server_default = None  # '{}'::jsonb can't render on sqlite
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


async def _notifs(session, user_id=None, kind=None):
    q = select(Notification)
    if user_id:
        q = q.where(Notification.user_id == user_id)
    if kind:
        q = q.where(Notification.kind == kind)
    return (await session.execute(q)).scalars().all()


def _bg():
    return BackgroundTasks()


# ── Tasks: CRUD + permissions ───────────────────────────────────────────

async def test_create_assign_and_patch_status(session):
    org = await _org(session)
    creator, assignee = uuid.uuid4(), uuid.uuid4()
    await _member_row(session, org.id, assignee)
    m = _member(org.id, creator)

    r = await create_task(org_id=org.id, session=session, bg=_bg(), member=m,
                          body=TaskIn(title="Print tarp", assignee_id=assignee,
                                      priority="high"))
    t = r["data"]
    assert t["status"] == "open" and t["priority"] == "high"
    assert t["assignee_ids"] == [assignee]

    # assignment wrote the assignee an inbox row in the same transaction
    notifs = await _notifs(session, assignee, "assigned")
    assert len(notifs) == 1
    assert notifs[0].payload["entity_type"] == "task"
    assert notifs[0].payload["entity_id"] == str(t["id"])

    # assignee can flip status — nothing else
    am = _member(org.id, assignee)
    r = await patch_task(org_id=org.id, task_id=t["id"], session=session, bg=_bg(),
                         member=am, body=TaskPatch(status="done"))
    assert r["data"]["status"] == "done" and r["data"]["completed_by"] == assignee

    with pytest.raises(APIError) as e:
        await patch_task(org_id=org.id, task_id=t["id"], session=session, bg=_bg(),
                         member=am, body=TaskPatch(title="renamed by assignee"))
    assert e.value.status_code == 403


async def test_task_edit_permission_matrix(session):
    org = await _org(session)
    creator, assignee, rando, owner = (uuid.uuid4() for _ in range(4))
    await _member_row(session, org.id, assignee)
    t = Task(org_id=org.id, title="T", creator_id=creator, assignee_id=assignee)
    session.add(t)
    await session.flush()

    # random member: no edits at all (not even status — they're not the assignee)
    with pytest.raises(APIError) as e:
        await patch_task(org_id=org.id, task_id=t.id, session=session, bg=_bg(),
                         member=_member(org.id, rando), body=TaskPatch(status="done"))
    assert e.value.status_code == 403

    # owner edits anything
    r = await patch_task(org_id=org.id, task_id=t.id, session=session, bg=_bg(),
                         member=_member(org.id, owner, "owner"),
                         body=TaskPatch(title="owner rename", status="cancelled"))
    assert r["data"]["title"] == "owner rename"

    # delete: creator or owner only
    with pytest.raises(APIError):
        await delete_task(org_id=org.id, task_id=t.id, session=session,
                          member=_member(org.id, rando))
    r = await delete_task(org_id=org.id, task_id=t.id, session=session,
                          member=_member(org.id, creator))
    assert r["ok"] is True


async def test_task_links_must_be_in_org(session):
    org, other_org = await _org(session), await _org(session)
    uid = uuid.uuid4()
    foreign_proj = Project(org_id=other_org.id, title="theirs")
    session.add(foreign_proj)
    await session.flush()
    m = _member(org.id, uid)

    with pytest.raises(APIError) as e:
        await create_task(org_id=org.id, session=session, bg=_bg(), member=m,
                          body=TaskIn(title="x", project_id=foreign_proj.id))
    assert e.value.status_code == 404

    # and a task in another org is invisible to this org's routes
    t = Task(org_id=other_org.id, title="T", creator_id=uid)
    session.add(t)
    await session.flush()
    with pytest.raises(APIError) as e2:
        await get_task(org_id=org.id, task_id=t.id, session=session, member=m)
    assert e2.value.status_code == 404


async def test_assignee_must_be_a_member(session):
    org = await _org(session)
    uid = uuid.uuid4()
    with pytest.raises(APIError) as e:
        await create_task(org_id=org.id, session=session, bg=_bg(),
                          member=_member(org.id, uid),
                          body=TaskIn(title="x", assignee_id=uuid.uuid4()))
    assert e.value.code == "NOT_A_MEMBER"


async def test_comments_ping_assignee_and_creator_not_commenter(session):
    org = await _org(session)
    creator, assignee, rando = (uuid.uuid4() for _ in range(3))
    await _member_row(session, org.id, assignee)
    t = Task(org_id=org.id, title="T", creator_id=creator, assignee_id=assignee)
    session.add(t)
    await session.flush()
    session.add(TaskAssignee(task_id=t.id, user_id=assignee))
    await session.flush()

    await add_comment(org_id=org.id, task_id=t.id, session=session, bg=_bg(),
                    member=_member(org.id, rando), body=CommentIn(body="any update?"))
    assert len(await _notifs(session, creator, "task_commented")) == 1
    assert len(await _notifs(session, assignee, "task_commented")) == 1
    assert await _notifs(session, rando) == []

    # creator commenting doesn't self-notify
    await add_comment(org_id=org.id, task_id=t.id, session=session, bg=_bg(),
                      member=_member(org.id, creator), body=CommentIn(body="on it"))
    assert len(await _notifs(session, creator)) == 1  # still just the first


# ── Idempotent creates (offline replay) ─────────────────────────────────

async def test_task_create_replay_returns_original(session):
    org = await _org(session)
    uid = uuid.uuid4()
    body = TaskIn(title="Draft letter", client_request_id="cr-abc")
    r1 = await create_task(org_id=org.id, body=body, session=session, bg=_bg(),
                           member=_member(org.id, uid))
    r2 = await create_task(org_id=org.id, body=body, session=session, bg=_bg(),
                           member=_member(org.id, uid))
    assert getattr(r2, "status_code", None) == 200  # JSONResponse, not a 201 dict
    rows = (await session.execute(select(Task).where(Task.org_id == org.id))).scalars().all()
    assert len(rows) == 1 and rows[0].id == r1["data"]["id"]


async def test_journal_and_movement_and_project_replays(session):
    org = await _org(session)
    uid = uuid.uuid4()
    m = _member(org.id, uid)

    r1 = await create_entry(org_id=org.id, session=session, member=m,
                            body=EntryIn(description="day one", client_request_id="j-1"))
    r2 = await create_entry(org_id=org.id, session=session, member=m,
                            body=EntryIn(description="day one", client_request_id="j-1"))
    assert getattr(r2, "status_code", None) == 200

    d = await create_document(org_id=org.id, session=session, bg=_bg(), member=m,
                              body=DocIn(title="Letter", doc_type="memo",
                                         client_request_id="d-1"))
    d2 = await create_document(org_id=org.id, session=session, bg=_bg(), member=m,
                               body=DocIn(title="Letter", doc_type="memo",
                                          client_request_id="d-1"))
    assert getattr(d2, "status_code", None) == 200
    assert len((await session.execute(select(Document))).scalars().all()) == 1

    mv1 = await add_movement(org_id=org.id, doc_id=d["data"].id, session=session, member=m,
                             body=MovementIn(location_text="office", client_request_id="m-1"))
    mv2 = await add_movement(org_id=org.id, doc_id=d["data"].id, session=session, member=m,
                             body=MovementIn(location_text="office", client_request_id="m-1"))
    assert getattr(mv2, "status_code", None) == 200
    assert len((await session.execute(select(DocumentMovement))).scalars().all()) == 1


async def test_replay_scopes_client_request_id_to_org(session):
    """Same client_request_id in another org is a different request, not a dup."""
    org1, org2 = await _org(session), await _org(session)
    uid = uuid.uuid4()
    for org in (org1, org2):
        await create_task(org_id=org.id, session=session, bg=_bg(),
                          member=_member(org.id, uid),
                          body=TaskIn(title="x", client_request_id="same"))
    rows = (await session.execute(select(Task))).scalars().all()
    assert len(rows) == 2


async def test_existing_assign_paths_fan_out_inbox(session):
    """Project lead + checklist item assignments now write inbox rows too —
    the whole point of the fan-out refactor."""
    org = await _org(session)
    actor, assignee = uuid.uuid4(), uuid.uuid4()
    await _member_row(session, org.id, assignee)
    adviser = _member(org.id, actor, "adviser")

    await create_project(org_id=org.id, session=session, bg=_bg(), member=adviser,
                         body=ProjectIn(title="Fair", owner_id=assignee))
    notifs = await _notifs(session, assignee, "assigned")
    assert len(notifs) == 1 and notifs[0].payload["entity_type"] == "project"

    proj = Project(org_id=org.id, title="P")
    session.add(proj)
    await session.flush()
    item = ProjectChecklistItem(org_id=org.id, project_id=proj.id, ord=1,
                                label="Book venue")
    session.add(item)
    await session.flush()
    await patch_item(org_id=org.id, item_id=item.id, session=session, bg=_bg(),
                     member=adviser, body=ChecklistItemPatch(assignee_id=assignee))
    notifs = await _notifs(session, assignee, "assigned")
    assert len(notifs) == 2
    # the notification's entity points at the parent project (where the
    # checklist lives), not the item row — deep-link target
    kinds = {n.payload["entity_type"] for n in notifs}
    assert kinds == {"project"}


# ── Movement ↔ step pinning ──────────────────────────────────────────────

async def test_movement_step_id_must_belong_to_doc(session):
    org = await _org(session)
    uid = uuid.uuid4()
    m = _member(org.id, uid, "officer")
    d1 = Document(org_id=org.id, title="A", doc_type="memo", created_by=uid)
    d2 = Document(org_id=org.id, title="B", doc_type="memo", created_by=uid)
    session.add_all([d1, d2])
    await session.flush()
    step = DocumentSignatoryStep(org_id=org.id, document_id=d2.id,
                                 ord=1, label="Dean")
    session.add(step)
    await session.flush()

    with pytest.raises(APIError) as e:
        await add_movement(org_id=org.id, doc_id=d1.id, session=session, member=m,
                           body=MovementIn(location_text="x", step_id=step.id))
    assert e.value.code == "STEP_MISMATCH"

    r = await add_movement(org_id=org.id, doc_id=d2.id, session=session, member=m,
                           body=MovementIn(location_text="x", step_id=step.id))
    assert r["data"].step_id == step.id


async def test_held_by_me_follows_latest_movement(session):
    """held_by=me = papers whose NEWEST custody move was made by me."""
    org = await _org(session)
    me_uid, other = uuid.uuid4(), uuid.uuid4()
    m = _member(org.id, me_uid)
    om = _member(org.id, other)

    d_mine = Document(org_id=org.id, title="with me", doc_type="memo",
                      created_by=other)
    d_theirs = Document(org_id=org.id, title="with them", doc_type="memo",
                        created_by=other)
    d_idle = Document(org_id=org.id, title="no moves yet", doc_type="memo",
                      created_by=other)
    session.add_all([d_mine, d_theirs, d_idle])
    await session.flush()

    # Explicit timestamps — sqlite's created_at has second precision, so
    # rapid router calls tie and ordering becomes arbitrary.
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    session.add_all([
        # d_mine: only move is mine
        DocumentMovement(org_id=org.id, document_id=d_mine.id,
                         location_text="my desk", moved_by=me_uid,
                         created_at=t0),
        # d_theirs: I moved it once, then they took it back — newest wins
        DocumentMovement(org_id=org.id, document_id=d_theirs.id,
                         location_text="my desk", moved_by=me_uid,
                         created_at=t0),
        DocumentMovement(org_id=org.id, document_id=d_theirs.id,
                         location_text="their desk", moved_by=other,
                         created_at=t0 + timedelta(hours=1)),
    ])
    await session.flush()

    r = await list_documents(org_id=org.id, session=session, held_by="me", member=m)
    ids = {d.id for d in r["data"]}
    assert ids == {d_mine.id}  # d_theirs moved on; d_idle never moved

    # from the other member's view, d_theirs is theirs
    r = await list_documents(org_id=org.id, session=session, held_by="me", member=om)
    assert {d.id for d in r["data"]} == {d_theirs.id}

    # without the param the list is unchanged
    r = await list_documents(org_id=org.id, session=session, member=m)
    assert len(r["data"]) == 3


# ── Notification inbox ───────────────────────────────────────────────────

async def test_inbox_is_self_scoped_and_marks_read(session):
    org = await _org(session)
    uid, other = uuid.uuid4(), uuid.uuid4()
    for who in (uid, other):
        session.add(Notification(org_id=org.id, user_id=who, kind="assigned",
                                 payload={"title": "t"}))
    await session.flush()
    m = _member(org.id, uid)

    r = await list_notifications(org_id=org.id, session=session, member=m)
    assert len(r["data"]) == 1 and r["unread"] == 1

    # marking the OTHER user's row does nothing to it
    other_row = (await session.execute(select(Notification).where(
        Notification.user_id == other))).scalars().one()
    await mark_read(org_id=org.id, session=session, member=m,
                    body=MarkRead(ids=[other_row.id]))
    await session.refresh(other_row)
    assert other_row.read_at is None

    r = await mark_all_read(org_id=org.id, session=session, member=m)
    assert r["data"]["read"] == 1
    r = await list_notifications(org_id=org.id, session=session, member=m)
    assert r["unread"] == 0


# ── Push tokens ──────────────────────────────────────────────────────────

async def test_push_token_lifecycle(session):
    org = await _org(session)
    u1, u2 = uuid.uuid4(), uuid.uuid4()

    await register_push_token(org_id=org.id, session=session,
                              member=_member(org.id, u1),
                              body=TokenIn(token="ExponentPushToken[aaa]", platform="android"))
    # same user re-registers → still one row, timestamp bumped
    await register_push_token(org_id=org.id, session=session,
                              member=_member(org.id, u1),
                              body=TokenIn(token="ExponentPushToken[aaa]", platform="android"))
    rows = (await session.execute(select(PushToken))).scalars().all()
    assert len(rows) == 1

    # device handoff: second user on the same device takes the token over
    await register_push_token(org_id=org.id, session=session,
                              member=_member(org.id, u2),
                              body=TokenIn(token="ExponentPushToken[aaa]", platform="android"))
    t = (await session.execute(select(PushToken))).scalars().one()
    assert t.user_id == u2

    # the previous owner can't delete what they no longer own
    with pytest.raises(APIError) as e:
        await delete_push_token(org_id=org.id, session=session,
                                member=_member(org.id, u1),
                                body=TokenDelete(token="ExponentPushToken[aaa]"))
    assert e.value.status_code == 404
    r = await delete_push_token(org_id=org.id, session=session,
                                member=_member(org.id, u2),
                                body=TokenDelete(token="ExponentPushToken[aaa]"))
    assert r["data"]["deleted"] is True


# ── Reminders cron ───────────────────────────────────────────────────────

async def test_reminders_requires_secret_and_dedupes(session, monkeypatch):
    org = await _org(session)
    uid = uuid.uuid4()
    tomorrow = org_today() + timedelta(days=1)
    t_due = Task(org_id=org.id, title="Print proposals", creator_id=uid,
                 assignee_id=uid, due_date=tomorrow)
    session.add(t_due)
    await session.flush()
    session.add(TaskAssignee(task_id=t_due.id, user_id=uid))
    await session.flush()

    s = get_settings()
    monkeypatch.setattr(s, "cron_secret", "sekrit")

    with pytest.raises(APIError) as e:
        await reminders(session=session, x_cron_secret="wrong")
    assert e.value.status_code == 403

    r = await reminders(session=session, x_cron_secret="sekrit")
    assert r["data"]["sent"]["task_due_soon"] == 1
    # second run same day → ref dedupe, no double ping
    r = await reminders(session=session, x_cron_secret="sekrit")
    assert r["data"]["sent"]["task_due_soon"] == 0
    assert len(await _notifs(session, uid, "task_due_soon")) == 1


async def test_reminders_pings_unfiled_duty_roster(session, monkeypatch):
    org = await _org(session)
    uid, filed = uuid.uuid4(), uuid.uuid4()
    today = org_today()
    sy = SchoolYear(org_id=org.id, label="2025-2026", is_current=True)
    session.add(sy)
    await session.flush()
    session.add_all([
        DutySchedule(org_id=org.id, school_year_id=sy.id,
                     weekday=today.weekday(), member_id=uid),
        DutySchedule(org_id=org.id, school_year_id=sy.id,
                     weekday=today.weekday(), member_id=filed),
        AttendanceDay(org_id=org.id, member_id=filed, day=today,
                      status="documented", duty_type="scheduled"),
    ])
    await session.flush()
    monkeypatch.setattr(get_settings(), "cron_secret", "sekrit")

    r = await reminders(session=session, x_cron_secret="sekrit")
    assert r["data"]["sent"]["duty_reminder"] == 1
    assert len(await _notifs(session, uid, "duty_reminder")) == 1
    assert await _notifs(session, filed) == []


# ── Desk routing + paper + people + progress notifications ─────────────

async def _sy(session, org):
    sy = SchoolYear(org_id=org.id, label="2026-2027", is_current=True)
    session.add(sy)
    await session.flush()
    return sy


async def _chain(session, org, doc_type, steps):
    """steps: [(label, office)] — office must match a Position.title to ping."""
    chain = SignatoryChain(org_id=org.id, name=f"{doc_type} route",
                           doc_type=doc_type)
    session.add(chain)
    await session.flush()
    for i, (label, office) in enumerate(steps, 1):
        session.add(SignatoryStep(chain_id=chain.id, ord=i, label=label,
                                  office=office))
    await session.flush()
    return chain


async def test_create_doc_pings_only_the_first_desk(session):
    """A routed paper notifies the FIRST desk — later desks ping as the
    paper reaches them, not all at once."""
    org = await _org(session)
    mover, clerk, dean = (uuid.uuid4() for _ in range(3))
    sy = await _sy(session, org)
    session.add_all([
        Position(org_id=org.id, school_year_id=sy.id, title="Clerk",
                 holder=clerk),
        Position(org_id=org.id, school_year_id=sy.id, title="Dean",
                 holder=dean),
    ])
    await _chain(session, org, "memo",
                 [("Records Clerk", "Clerk"), ("Dean", "Dean")])

    r = await create_document(
        org_id=org.id, session=session, bg=_bg(),
        member=_member(org.id, mover, "officer"),
        body=DocIn(title="Budget letter", doc_type="memo"))

    assert r["data"].status == "routing"
    clerk_notes = await _notifs(session, clerk, "sign_needed")
    assert len(clerk_notes) == 1
    assert clerk_notes[0].payload["desk"] == "Records Clerk"
    assert clerk_notes[0].payload["entity_type"] == "document"
    assert await _notifs(session, dean) == []          # not their turn yet
    assert await _notifs(session, mover) == []         # never ping yourself


async def test_step_advance_pings_next_desk_then_signed(session):
    """Signing hands the paper to the next desk; the last signature tells
    the mover it's fully signed."""
    org = await _org(session)
    mover, clerk, dean = (uuid.uuid4() for _ in range(3))
    sy = await _sy(session, org)
    session.add_all([
        Position(org_id=org.id, school_year_id=sy.id, title="Clerk",
                 holder=clerk),
        Position(org_id=org.id, school_year_id=sy.id, title="Dean",
                 holder=dean),
    ])
    doc = Document(org_id=org.id, title="Letter", doc_type="memo",
                   status="routing", created_by=mover)
    session.add(doc)
    await session.flush()
    s1 = DocumentSignatoryStep(org_id=org.id, document_id=doc.id, ord=1,
                               label="Clerk", office="Clerk")
    s2 = DocumentSignatoryStep(org_id=org.id, document_id=doc.id, ord=2,
                               label="Dean", office="Dean")
    session.add_all([s1, s2])
    await session.flush()
    officer = _member(org.id, clerk, "officer")

    await advance_step(org_id=org.id, doc_id=doc.id, step_id=s1.id,
                       session=session, bg=_bg(), member=officer,
                       body=StepAdvance(status="signed"))
    dean_notes = await _notifs(session, dean, "sign_needed")
    assert len(dean_notes) == 1 and "waiting" not in dean_notes[0].kind
    assert (await session.get(Document, doc.id)).status == "routing"
    assert await _notifs(session, mover, "doc_signed") == []

    await advance_step(org_id=org.id, doc_id=doc.id, step_id=s2.id,
                       session=session, bg=_bg(), member=officer,
                       body=StepAdvance(status="signed"))
    assert (await session.get(Document, doc.id)).status == "signed"
    done_notes = await _notifs(session, mover, "doc_signed")
    assert len(done_notes) == 1
    # nobody left pending → no more desk pings
    assert len(await _notifs(session, dean, "sign_needed")) == 1


async def test_revision_pings_mover_and_the_desk_it_returns_to(session):
    """Sent-back papers tell the mover AND the holder of the desk the
    paper lands back on."""
    from app.routers.documents import RevisionIn, request_revision
    org = await _org(session)
    mover, dean, president = (uuid.uuid4() for _ in range(3))
    sy = await _sy(session, org)
    session.add(Position(org_id=org.id, school_year_id=sy.id,
                         title="President", holder=president))
    doc = Document(org_id=org.id, title="Letter", doc_type="memo",
                   status="routing", created_by=mover)
    session.add(doc)
    await session.flush()
    s1 = DocumentSignatoryStep(org_id=org.id, document_id=doc.id, ord=1,
                               label="President", office="President",
                               status="signed")
    s2 = DocumentSignatoryStep(org_id=org.id, document_id=doc.id, ord=2,
                               label="Dean", office="Dean")
    session.add_all([s1, s2])
    await session.flush()

    await request_revision(
        org_id=org.id, doc_id=doc.id, session=session, bg=_bg(),
        member=_member(org.id, dean, "officer"),
        body=RevisionIn(return_to_step_id=s1.id, note="fix the date"))

    assert len(await _notifs(session, mover, "sent_back")) == 1
    assert len(await _notifs(session, president, "sent_back")) == 1
    assert await _notifs(session, dean, "sent_back") == []   # actor skipped


async def test_task_done_pings_creator_and_project_done_pings_lead(session):
    org = await _org(session)
    creator, assignee, lead, adviser = (uuid.uuid4() for _ in range(4))
    await _member_row(session, org.id, assignee)
    t = Task(org_id=org.id, title="Print tarp", creator_id=creator,
             assignee_id=assignee)
    p = Project(org_id=org.id, title="Fair", owner_id=lead, status="active")
    session.add_all([t, p])
    await session.flush()
    session.add(TaskAssignee(task_id=t.id, user_id=assignee))
    await session.flush()

    await patch_task(org_id=org.id, task_id=t.id, session=session, bg=_bg(),
                     member=_member(org.id, assignee),
                     body=TaskPatch(status="done"))
    done = await _notifs(session, creator, "task_done")
    assert len(done) == 1 and done[0].payload["entity_id"] == str(t.id)
    assert await _notifs(session, assignee, "task_done") == []

    await patch_project(org_id=org.id, project_id=p.id, session=session,
                        bg=_bg(), member=_member(org.id, adviser, "adviser"),
                        body=ProjectPatch(status="done"))
    pnotifs = await _notifs(session, lead, "project_done")
    assert len(pnotifs) == 1 and pnotifs[0].payload["status"] == "done"


async def test_join_request_pings_owners_decision_pings_requester(session):
    org = await _org(session)
    owner, requester = uuid.uuid4(), uuid.uuid4()
    await _member_row(session, org.id, owner, "owner")
    session.add(Profile(id=requester, display_name="New Kid"))
    await session.flush()
    user = AuthUser(id=str(requester), email="new@x.test", claims={})

    await request_join(org_id=org.id, session=session, bg=_bg(), user=user,
                       body=JoinReqCreate())
    jns = await _notifs(session, owner, "join_request")
    assert len(jns) == 1 and jns[0].payload["name"] == "New Kid"
    assert await _notifs(session, requester) == []

    jr = (await session.execute(select(JoinRequest))).scalars().one()
    await decide_join(org_id=org.id, request_id=jr.id, session=session,
                      bg=_bg(), member=_member(org.id, owner, "owner"),
                      body=DecideBody(approve=True))
    dec = await _notifs(session, requester, "join_decided")
    assert len(dec) == 1 and dec[0].payload["approved"] is True


async def test_stale_desk_nags_once_ever(session, monkeypatch):
    """A pending step older than STALE_DESK_DAYS pings its holder — and
    only once, not every cron run."""
    org = await _org(session)
    holder = uuid.uuid4()
    sy = await _sy(session, org)
    session.add(Position(org_id=org.id, school_year_id=sy.id, title="Dean",
                         holder=holder))
    doc = Document(org_id=org.id, title="Letter", doc_type="memo",
                   status="routing", created_by=uuid.uuid4())
    session.add(doc)
    await session.flush()
    old = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=4)
    step = DocumentSignatoryStep(org_id=org.id, document_id=doc.id, ord=1,
                                 label="Dean", office="Dean",
                                 created_at=old)
    session.add(step)
    await session.flush()
    monkeypatch.setattr(get_settings(), "cron_secret", "sekrit")

    r = await reminders(session=session, x_cron_secret="sekrit")
    assert r["data"]["sent"]["desk_stale"] == 1
    assert len(await _notifs(session, holder, "desk_stale")) == 1
    # next day's run doesn't re-nag — the ref is the step, not the day
    r = await reminders(session=session, x_cron_secret="sekrit")
    assert r["data"]["sent"]["desk_stale"] == 0
    assert len(await _notifs(session, holder, "desk_stale")) == 1


async def test_dead_tokens_pruned_on_device_not_registered(session, monkeypatch):
    """Expo says a device is gone → its push_tokens row gets deleted so we
    stop hammering dead installs."""
    from app.services import push as push_service
    uid = uuid.uuid4()
    session.add_all([
        PushToken(user_id=uid, token="ExponentPushToken[dead]",
                  platform="android"),
        PushToken(user_id=uid, token="ExponentPushToken[live]",
                  platform="android"),
    ])
    await session.flush()

    class FakeResp:
        status_code = 200
        text = ""

        def json(self):
            return {"data": [
                {"status": "error",
                 "details": {"error": "DeviceNotRegistered"}},
                {"status": "ok"}]}

    class FakeClient:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            return FakeResp()

    monkeypatch.setattr(push_service.httpx, "AsyncClient", FakeClient)
    ok = await push_service.send_push(session, uid, title="t", body="b")
    assert ok is True
    remaining = (await session.execute(select(PushToken))).scalars().all()
    assert [t.token for t in remaining] == ["ExponentPushToken[live]"]
