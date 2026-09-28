"""Edit/delete/retract semantics for daily-loop records:
journal entries, no-tasks declarations, document movements.

Handlers are invoked directly with a constructed Membership — same pattern
as test_admin.py — so the permission matrix and side effects (attendance
recompute, tri-state patch fields, audit rows) are all covered without an
HTTP harness.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlmodel import select


@compiles(JSONB, "sqlite")
def _jsonb_as_json(element, compiler, **kw):
    """Postgres JSONB doesn't compile on sqlite — render as JSON for tests."""
    return "JSON"

from app.deps import Membership
from app.errors import APIError
from app.models import (AttendanceDay, AuditLog, Document, DocumentMovement,
                        JournalEntry, JournalPhoto, Project)
from app.pagination import org_today
from app.routers.daily import EntryPatch, delete_entry, patch_entry, retract_no_tasks
from app.routers.documents import (MovementPatch, delete_movement,
                                   patch_movement)

TABLES = (JournalEntry.__table__, JournalPhoto.__table__, AttendanceDay.__table__,
          Project.__table__, Document.__table__, DocumentMovement.__table__,
          AuditLog.__table__)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in TABLES:
            # Postgres-only cast syntax in server_default can't render on sqlite
            if "flags" in t.c:
                t.c.flags.server_default = None
            await conn.run_sync(t.create)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


def _member(org_id, uid, role="member") -> Membership:
    return Membership(org_id=org_id, user_id=str(uid), role=role)


def _entry(org_id, member_id, *, day=None, description="worked on it", project_id=None):
    e = JournalEntry(org_id=org_id, member_id=member_id,
                     entry_date=day or org_today(), description=description,
                     project_id=project_id)
    return e


async def _audits(session, action=None):
    rows = (await session.execute(select(AuditLog))).scalars().all()
    return [r for r in rows if action is None or r.action == action]


# ── Journal: patch ──────────────────────────────────────────────────────

async def test_author_edits_own_same_day(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    e = _entry(org, uid)
    session.add(e)
    await session.flush()

    r = await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(description="fixed text"),
                          session=session, member=_member(org, uid))
    assert r["data"].description == "fixed text"
    # own same-day edits aren't audit events — nothing sensitive happened
    assert await _audits(session) == []


async def test_author_cannot_edit_other_or_past_day(session):
    org, uid, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    theirs = _entry(org, other)
    old = _entry(org, uid, day=org_today() - timedelta(days=1))
    session.add_all([theirs, old])
    await session.flush()

    with pytest.raises(APIError) as e1:
        await patch_entry(org_id=org, entry_id=theirs.id,
                          body=EntryPatch(description="x"),
                          session=session, member=_member(org, uid))
    assert e1.value.status_code == 403

    with pytest.raises(APIError) as e2:
        await patch_entry(org_id=org, entry_id=old.id,
                          body=EntryPatch(description="x"),
                          session=session, member=_member(org, uid))
    assert e2.value.status_code == 403


async def test_owner_edits_past_day_and_it_is_audited(session):
    org, uid, owner = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    e = _entry(org, uid, day=org_today() - timedelta(days=1))
    session.add(e)
    await session.flush()

    r = await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(description="owner fix"),
                          session=session, member=_member(org, owner, "owner"))
    assert r["data"].description == "owner fix"
    audits = await _audits(session, "journal.edited_post_day")
    assert len(audits) == 1 and audits[0].actor_id == owner


async def test_patch_project_id_is_tri_state(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    proj = Project(org_id=org, title="Fair")
    session.add(proj)
    e = _entry(org, uid)
    session.add(e)
    await session.flush()

    m = _member(org, uid)
    # set
    r = await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(project_id=proj.id), session=session, member=m)
    assert r["data"].project_id == proj.id
    # clear — explicit null must reach the row (was a real bug: null was skipped)
    r = await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(project_id=None), session=session, member=m)
    assert r["data"].project_id is None
    # absent leaves it alone
    e.project_id = proj.id
    await session.flush()
    r = await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(description="t"), session=session, member=m)
    assert r["data"].project_id == proj.id


async def test_patch_rejects_foreign_project_and_foreign_entry(session):
    org, other_org, uid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    foreign_proj = Project(org_id=other_org, title="Nope")
    e = _entry(org, uid)
    foreign_entry = _entry(other_org, uid)
    session.add_all([foreign_proj, e, foreign_entry])
    await session.flush()

    m = _member(org, uid)
    with pytest.raises(APIError) as e1:
        await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(project_id=foreign_proj.id),
                          session=session, member=m)
    assert e1.value.status_code == 404

    with pytest.raises(APIError) as e2:
        await patch_entry(org_id=org, entry_id=foreign_entry.id,
                          body=EntryPatch(description="x"),
                          session=session, member=_member(org, uid, "owner"))
    assert e2.value.status_code == 404


# ── Journal: delete ─────────────────────────────────────────────────────

async def test_delete_last_entry_undocuments_the_day(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    e = _entry(org, uid)
    att = AttendanceDay(org_id=org, member_id=uid, day=e.entry_date,
                        status="documented", duty_type="scheduled")
    session.add_all([e, att])
    await session.flush()

    await delete_entry(org_id=org, entry_id=e.id, session=session, member=_member(org, uid))
    assert await session.get(JournalEntry, e.id) is None
    assert await session.get(AttendanceDay, att.id) is None
    assert len(await _audits(session, "journal.deleted")) == 1


async def test_delete_keeps_documented_when_sibling_remains(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    e1, e2 = _entry(org, uid), _entry(org, uid)
    att = AttendanceDay(org_id=org, member_id=uid, day=e1.entry_date,
                        status="documented", duty_type="extra")
    session.add_all([e1, e2, att])
    await session.flush()

    await delete_entry(org_id=org, entry_id=e1.id, session=session, member=_member(org, uid))
    assert (await session.get(AttendanceDay, att.id)).status == "documented"


async def test_delete_permission_matrix(session):
    org, uid, other, owner = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    theirs = _entry(org, other)
    old = _entry(org, uid, day=org_today() - timedelta(days=1))
    owner_target = _entry(org, other, day=org_today() - timedelta(days=1))
    session.add_all([theirs, old, owner_target])
    await session.flush()

    with pytest.raises(APIError):
        await delete_entry(org_id=org, entry_id=theirs.id, session=session, member=_member(org, uid))
    with pytest.raises(APIError):
        await delete_entry(org_id=org, entry_id=old.id, session=session, member=_member(org, uid))

    await delete_entry(org_id=org, entry_id=owner_target.id,
                       session=session, member=_member(org, owner, "owner"))
    assert await session.get(JournalEntry, owner_target.id) is None


async def test_delete_removes_photo_rows(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    e = _entry(org, uid)
    session.add(e)
    await session.flush()
    p = JournalPhoto(entry_id=e.id, org_id=org,
                     storage_path=f"{org}/uploads/{uuid.uuid4()}",
                     mime="image/jpeg", byte_size=10)
    session.add(p)
    await session.flush()

    await delete_entry(org_id=org, entry_id=e.id, session=session, member=_member(org, uid))
    assert await session.get(JournalPhoto, p.id) is None


# ── Attendance: retract ─────────────────────────────────────────────────

async def _declared(session, org, uid, day=None):
    att = AttendanceDay(org_id=org, member_id=uid, day=day or org_today(),
                        status="declared_no_tasks", duty_type="scheduled")
    session.add(att)
    await session.flush()
    return att


async def test_retract_own_same_day(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    att = await _declared(session, org, uid)
    r = await retract_no_tasks(org_id=org, day=att.day, session=session,
                               member_id=None, member=_member(org, uid))
    assert r["data"]["deleted"] is True
    assert await session.get(AttendanceDay, att.id) is None


async def test_retract_documented_day_conflicts(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    att = AttendanceDay(org_id=org, member_id=uid, day=org_today(),
                        status="documented", duty_type="scheduled")
    session.add(att)
    await session.flush()
    with pytest.raises(APIError) as e:
        await retract_no_tasks(org_id=org, day=att.day, session=session,
                               member_id=None, member=_member(org, uid))
    assert e.value.status_code == 409 and e.value.code == "DOCUMENTED_DAY"


async def test_retract_requires_own_today_or_owner(session):
    org, uid, other, owner = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    yesterday = org_today() - timedelta(days=1)
    own_old = await _declared(session, org, uid, yesterday)
    others = await _declared(session, org, other)

    m = _member(org, uid)
    with pytest.raises(APIError) as e1:   # own but not today
        await retract_no_tasks(org_id=org, day=own_old.day, session=session,
                               member_id=None, member=m)
    assert e1.value.status_code == 403
    with pytest.raises(APIError) as e2:   # someone else's
        await retract_no_tasks(org_id=org, day=others.day, session=session,
                               member_id=other, member=m)
    assert e2.value.status_code == 403

    # owner retracts someone else's today
    r = await retract_no_tasks(org_id=org, day=others.day, session=session,
                               member_id=other, member=_member(org, owner, "owner"))
    assert r["data"]["deleted"] is True
    assert len(await _audits(session, "attendance.retracted")) == 1


async def test_retract_missing_row_404s(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    with pytest.raises(APIError) as e:
        await retract_no_tasks(org_id=org, day=org_today(), session=session,
                               member_id=None, member=_member(org, uid))
    assert e.value.status_code == 404


# ── Movements: patch + delete ───────────────────────────────────────────

async def _doc(session, org, creator=None):
    d = Document(org_id=org, title="Paper", doc_type="concept_paper",
                 created_by=creator or uuid.uuid4())
    session.add(d)
    await session.flush()
    return d


def _mv(session, org, doc_id, mover, *, days_ago=0, location="SD office"):
    mv = DocumentMovement(org_id=org, document_id=doc_id, moved_by=mover,
                          location_text=location, note=None)
    if days_ago:
        mv.created_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
    session.add(mv)
    return mv


async def test_mover_edits_own_movement_note_tri_state(session):
    org, uid = uuid.uuid4(), uuid.uuid4()
    doc = await _doc(session, org)
    mv = _mv(session, org, doc.id, uid)
    await session.flush()
    m = _member(org, uid, "officer")

    r = await patch_movement(org_id=org, doc_id=doc.id, movement_id=mv.id,
                             body=MovementPatch(note="dropped at desk"),
                             session=session, member=m)
    assert r["data"].note == "dropped at desk"
    r = await patch_movement(org_id=org, doc_id=doc.id, movement_id=mv.id,
                             body=MovementPatch(note=None),   # explicit clear
                             session=session, member=m)
    assert r["data"].note is None
    # absent note doesn't touch the value
    mv.note = "keep"
    r = await patch_movement(org_id=org, doc_id=doc.id, movement_id=mv.id,
                             body=MovementPatch(location_text="Registrars"),
                             session=session, member=m)
    assert r["data"].note == "keep" and r["data"].location_text == "Registrars"


async def test_movement_edit_permission_matrix(session):
    org, mover, officer, owner = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    doc = await _doc(session, org)
    others = _mv(session, org, doc.id, mover)
    old = _mv(session, org, doc.id, officer, days_ago=1)
    await session.flush()

    m = _member(org, officer, "officer")
    with pytest.raises(APIError) as e1:   # not the mover
        await patch_movement(org_id=org, doc_id=doc.id, movement_id=others.id,
                             body=MovementPatch(note="x"), session=session, member=m)
    assert e1.value.status_code == 403
    with pytest.raises(APIError) as e2:   # mover but stale day
        await delete_movement(org_id=org, doc_id=doc.id, movement_id=old.id,
                              session=session, member=m)
    assert e2.value.status_code == 403

    # owner can edit any
    r = await patch_movement(org_id=org, doc_id=doc.id, movement_id=old.id,
                             body=MovementPatch(note="owner fix"),
                             session=session, member=_member(org, owner, "owner"))
    assert r["data"].note == "owner fix"
    assert len(await _audits(session, "document.movement_edited")) == 1


async def test_delete_movement_scopes_to_doc_and_org(session):
    org, other_org, uid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    doc = await _doc(session, org)
    doc2 = await _doc(session, org)
    mv = _mv(session, org, doc.id, uid)
    await session.flush()
    owner = _member(org, uid, "owner")

    with pytest.raises(APIError):        # movement not under this doc
        await delete_movement(org_id=org, doc_id=doc2.id, movement_id=mv.id,
                              session=session, member=owner)
    with pytest.raises(APIError):        # movement not under this org
        await delete_movement(org_id=other_org, doc_id=doc.id, movement_id=mv.id,
                              session=session, member=owner)

    r = await delete_movement(org_id=org, doc_id=doc.id, movement_id=mv.id,
                              session=session, member=owner)
    assert r["data"]["deleted"] is True
    assert await session.get(DocumentMovement, mv.id) is None
    audits = await _audits(session, "document.movement_deleted")
    assert len(audits) == 1 and audits[0].metadata_["location"] == "SD office"
