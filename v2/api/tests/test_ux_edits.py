"""UX-edit semantics: editable checklists, project status transitions,
journal/movement photo editing, and signatory send-back rounds.

Handlers are invoked directly with a constructed Membership — same pattern
as test_daily_edits.py — so the permission matrix and side effects (audit
rows, supersede/clone rounds, photo row churn) are covered without HTTP.
Storage calls are monkeypatched: these tests assert the API contract, not
Supabase plumbing.
"""
import uuid
from datetime import date

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks
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
from app.models import (AuditLog, Document, DocumentMovement, DocumentRevision,
                        DocumentSignatoryStep, JournalEntry, JournalPhoto,
                        Notification, OrgMember, Organization, Profile,
                        Project, ProjectChecklistItem)
from app.pagination import org_today
from app.routers.daily import EntryPatch, patch_entry
from app.routers.documents import (MovementPatch, RevisionIn, patch_movement,
                                   request_revision)
from app.routers.projects import (ChecklistItemPatch, ItemSeed, ProjectIn,
                                  ProjectPatch, ReorderIn, add_checklist_item,
                                  create_project, delete_checklist_item,
                                  patch_item, patch_project,
                                  reorder_checklist_items)
from app.services import storage

TABLES = (Project.__table__, ProjectChecklistItem.__table__,
          JournalEntry.__table__, JournalPhoto.__table__,
          Document.__table__, DocumentMovement.__table__,
          DocumentSignatoryStep.__table__, DocumentRevision.__table__,
          Organization.__table__, Profile.__table__, OrgMember.__table__,
          Notification.__table__, AuditLog.__table__)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in TABLES:
            if "flags" in t.c:
                t.c.flags.server_default = None
            if "payload" in t.c:
                t.c.payload.server_default = None
            await conn.run_sync(t.create)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


@pytest.fixture
def fake_storage(monkeypatch):
    """Storage is contract-tested: head returns jpeg magic, deletes recorded."""
    deleted = []

    async def _head(path):
        return b"\xff\xd8\xff\xe0" + b"\x00" * 12

    async def _delete(path, bucket=None):
        deleted.append(path)

    monkeypatch.setattr(storage, "object_head", _head)
    monkeypatch.setattr(storage, "delete_object", _delete)
    return deleted


def _member(org_id, uid, role="member") -> Membership:
    return Membership(org_id=org_id, user_id=str(uid), role=role)


def _project(org_id, owner=None, **kw) -> Project:
    return Project(org_id=org_id, title="Fair", owner_id=owner, **kw)


def _photo(entry_id, org_id) -> JournalPhoto:
    return JournalPhoto(entry_id=entry_id, org_id=org_id,
                        storage_path=f"{org_id}/uploads/{uuid.uuid4()}",
                        mime="image/jpeg", byte_size=100)


def _step(org_id, doc_id, ord, label, status="pending", round_no=1):
    return DocumentSignatoryStep(org_id=org_id, document_id=doc_id, ord=ord,
                                 label=label, status=status, round_no=round_no)


async def _audits(session, action):
    rows = (await session.execute(select(AuditLog))).scalars().all()
    return [r for r in rows if r.action == action]


def _bg() -> BackgroundTasks:
    return BackgroundTasks()


# ── Create project with an explicit checklist snapshot ──────────────────

async def test_create_project_writes_item_snapshot(session):
    org, adviser = uuid.uuid4(), uuid.uuid4()
    r = await create_project(
        org_id=org,
        body=ProjectIn(title="Fair", checklist_items=[
            ItemSeed(label="Book venue", due_date=date(2026, 3, 1)),
            ItemSeed(label="Draft letter", required=False),
        ]),
        session=session, bg=_bg(), member=_member(org, adviser, "adviser"))
    p = r["data"]
    items = (await session.execute(select(ProjectChecklistItem).where(
        ProjectChecklistItem.project_id == p.id))).scalars().all()
    assert [(i.ord, i.label, i.required) for i in items] == [
        (0, "Book venue", True), (1, "Draft letter", False)]
    assert items[0].due_date == date(2026, 3, 1)


async def test_create_project_without_items_leaves_checklist_empty(session):
    org, adviser = uuid.uuid4(), uuid.uuid4()
    r = await create_project(org_id=org, body=ProjectIn(title="Bare"),
                             session=session, bg=_bg(),
                             member=_member(org, adviser, "adviser"))
    assert (await session.execute(select(ProjectChecklistItem).where(
        ProjectChecklistItem.project_id == r["data"].id))).scalars().all() == []


# ── Checklist item structure: permissions + invariants ──────────────────

async def test_structural_edit_permission_matrix(session):
    org = uuid.uuid4()
    lead, member, adviser = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    p = _project(org, owner=lead)
    it = ProjectChecklistItem(org_id=org, project_id=p.id, ord=0, label="Venue")
    session.add_all([p, it])
    await session.flush()

    # random member can't reshape the checklist
    with pytest.raises(APIError) as e:
        await patch_item(org_id=org, item_id=it.id,
                         body=ChecklistItemPatch(label="Gym"),
                         session=session, bg=_bg(), member=_member(org, member))
    assert e.value.status_code == 403

    # the project lead can — even at plain member rank
    r = await patch_item(org_id=org, item_id=it.id,
                         body=ChecklistItemPatch(label="Gym", required=False),
                         session=session, bg=_bg(), member=_member(org, lead))
    assert r["data"].label == "Gym" and r["data"].required is False
    assert len(await _audits(session, "checklist_item.edited")) == 1

    # adviser+ can too
    r = await patch_item(org_id=org, item_id=it.id,
                         body=ChecklistItemPatch(hint="ask admin"),
                         session=session, bg=_bg(), member=_member(org, adviser, "adviser"))
    assert r["data"].hint == "ask admin"


async def test_tick_and_assign_permission_matrix(session):
    org = uuid.uuid4()
    member, officer, adviser, target = (uuid.uuid4() for _ in range(4))
    p = _project(org)
    it = ProjectChecklistItem(org_id=org, project_id=p.id, ord=0, label="Venue")
    session.add_all([p, it,
                     OrgMember(org_id=org, user_id=officer, role="officer", status="active"),
                     OrgMember(org_id=org, user_id=target, role="member", status="active")])
    await session.flush()

    # ticking needs officer+
    with pytest.raises(APIError) as e:
        await patch_item(org_id=org, item_id=it.id, body=ChecklistItemPatch(done=True),
                         session=session, bg=_bg(), member=_member(org, member))
    assert e.value.status_code == 403
    r = await patch_item(org_id=org, item_id=it.id, body=ChecklistItemPatch(done=True),
                         session=session, bg=_bg(), member=_member(org, officer, "officer"))
    assert r["data"].done is True and str(r["data"].done_by) == str(officer)

    # officer may self-assign but can't assign to someone else
    r = await patch_item(org_id=org, item_id=it.id,
                         body=ChecklistItemPatch(assignee_id=officer),
                         session=session, bg=_bg(), member=_member(org, officer, "officer"))
    assert r["data"].assignee_id == officer
    with pytest.raises(APIError) as e:
        await patch_item(org_id=org, item_id=it.id,
                         body=ChecklistItemPatch(assignee_id=target),
                         session=session, bg=_bg(), member=_member(org, officer, "officer"))
    assert e.value.status_code == 403
    r = await patch_item(org_id=org, item_id=it.id,
                         body=ChecklistItemPatch(assignee_id=target),
                         session=session, bg=_bg(), member=_member(org, adviser, "adviser"))
    assert r["data"].assignee_id == target


async def test_assign_to_non_member_rejected(session):
    org = uuid.uuid4()
    p = _project(org)
    it = ProjectChecklistItem(org_id=org, project_id=p.id, ord=0, label="Venue")
    session.add_all([p, it])
    await session.flush()
    with pytest.raises(APIError) as e:
        await patch_item(org_id=org, item_id=it.id,
                         body=ChecklistItemPatch(assignee_id=uuid.uuid4()),
                         session=session, bg=_bg(),
                         member=_member(org, uuid.uuid4(), "adviser"))
    assert e.value.status_code == 422


async def test_add_reorder_delete_item(session):
    org = uuid.uuid4()
    lead, member = uuid.uuid4(), uuid.uuid4()
    p = _project(org, owner=lead)
    a = ProjectChecklistItem(org_id=org, project_id=p.id, ord=0, label="A")
    b = ProjectChecklistItem(org_id=org, project_id=p.id, ord=1, label="B")
    session.add_all([p, a, b])
    await session.flush()
    lead_m, member_m = _member(org, lead), _member(org, member)

    # member can't add; lead can, ord lands at the end
    with pytest.raises(APIError) as e:
        await add_checklist_item(org_id=org, project_id=p.id,
                                 body=ItemSeed(label="C"), session=session, member=member_m)
    assert e.value.status_code == 403
    r = await add_checklist_item(org_id=org, project_id=p.id,
                                 body=ItemSeed(label="C"), session=session, member=lead_m)
    c = r["data"]
    assert c.ord == 2

    # reorder requires exactly this project's item set
    with pytest.raises(APIError) as e:
        await reorder_checklist_items(org_id=org, project_id=p.id,
                                      body=ReorderIn(item_ids=[c.id, b.id]),
                                      session=session, member=lead_m)
    assert e.value.status_code == 422
    await reorder_checklist_items(org_id=org, project_id=p.id,
                                  body=ReorderIn(item_ids=[c.id, b.id, a.id]),
                                  session=session, member=lead_m)
    await session.refresh(a)
    assert a.ord == 2 and b.ord == 1 and c.ord == 0

    # delete: member forbidden, lead allowed
    with pytest.raises(APIError):
        await delete_checklist_item(org_id=org, item_id=b.id,
                                    session=session, member=member_m)
    await delete_checklist_item(org_id=org, item_id=b.id,
                                session=session, member=lead_m)
    assert await session.get(ProjectChecklistItem, b.id) is None
    assert len(await _audits(session, "checklist_item.deleted")) == 1


async def test_cross_org_item_404s(session):
    org, other_org = uuid.uuid4(), uuid.uuid4()
    p = _project(other_org)
    it = ProjectChecklistItem(org_id=other_org, project_id=p.id, ord=0, label="X")
    session.add_all([p, it])
    await session.flush()
    owner = _member(org, uuid.uuid4(), "owner")
    with pytest.raises(APIError) as e:
        await patch_item(org_id=org, item_id=it.id,
                         body=ChecklistItemPatch(label="y"),
                         session=session, bg=_bg(), member=owner)
    assert e.value.status_code == 404
    with pytest.raises(APIError) as e:
        await delete_checklist_item(org_id=org, item_id=it.id,
                                    session=session, member=owner)
    assert e.value.status_code == 404


# ── Project status transitions ──────────────────────────────────────────

async def test_lead_can_move_status_but_nothing_else(session):
    org = uuid.uuid4()
    lead, member = uuid.uuid4(), uuid.uuid4()
    p = _project(org, owner=lead)
    session.add(p)
    await session.flush()

    r = await patch_project(org_id=org, project_id=p.id,
                            body=ProjectPatch(status="done"),
                            session=session, bg=_bg(), member=_member(org, lead))
    assert r["data"].status == "done"

    # lead + anything else is still adviser territory
    with pytest.raises(APIError) as e:
        await patch_project(org_id=org, project_id=p.id,
                            body=ProjectPatch(status="active", title="Rename"),
                            session=session, bg=_bg(), member=_member(org, lead))
    assert e.value.status_code == 403
    # non-lead member can't even move status
    with pytest.raises(APIError) as e:
        await patch_project(org_id=org, project_id=p.id,
                            body=ProjectPatch(status="active"),
                            session=session, bg=_bg(), member=_member(org, member))
    assert e.value.status_code == 403

    # adviser moves it back — transitions run both ways
    r = await patch_project(org_id=org, project_id=p.id,
                            body=ProjectPatch(status="archived"),
                            session=session, bg=_bg(),
                            member=_member(org, uuid.uuid4(), "adviser"))
    assert r["data"].status == "archived"


# ── Journal photo edits ─────────────────────────────────────────────────

def _entry(org_id, uid, **kw) -> JournalEntry:
    return JournalEntry(org_id=org_id, member_id=uid, entry_date=org_today(),
                        description="worked", **kw)


async def test_journal_add_photo_validates_like_create(session, fake_storage):
    org, uid = uuid.uuid4(), uuid.uuid4()
    e = _entry(org, uid)
    session.add(e)
    await session.flush()
    m = _member(org, uid)
    good = {"storage_path": f"{org}/uploads/p.jpg", "mime": "image/jpeg", "byte_size": 10}

    # foreign-org path can't be smuggled in
    with pytest.raises(APIError) as e1:
        await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(add_photos=[{**good,
                                                       "storage_path": f"{uuid.uuid4()}/x.jpg"}]),
                          session=session, member=m)
    assert e1.value.status_code == 422

    r = await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(add_photos=[good]),
                          session=session, member=m)
    photos = (await session.execute(select(JournalPhoto).where(
        JournalPhoto.entry_id == e.id))).scalars().all()
    assert len(photos) == 1 and photos[0].storage_path == good["storage_path"]


async def test_journal_add_photo_missing_or_wrong_type(session, monkeypatch):
    org, uid = uuid.uuid4(), uuid.uuid4()
    e = _entry(org, uid)
    session.add(e)
    await session.flush()
    m = _member(org, uid)

    async def _none(path):
        return None
    monkeypatch.setattr(storage, "object_head", _none)
    with pytest.raises(APIError) as e1:
        await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(add_photos=[{"storage_path": f"{org}/a.jpg",
                                                       "mime": "image/jpeg", "byte_size": 5}]),
                          session=session, member=m)
    assert e1.value.code == "UPLOAD_MISSING"

    async def _head(path):
        return b"\x89PNG" + b"\x00" * 12  # not jpeg bytes
    monkeypatch.setattr(storage, "object_head", _head)
    with pytest.raises(APIError) as e2:
        await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(add_photos=[{"storage_path": f"{org}/a.jpg",
                                                       "mime": "image/jpeg", "byte_size": 5}]),
                          session=session, member=m)
    assert e2.value.code == "BAD_FILE_TYPE"


async def test_journal_remove_photo_scoped_to_entry(session, fake_storage):
    org, uid = uuid.uuid4(), uuid.uuid4()
    e, other = _entry(org, uid), _entry(org, uid)
    session.add_all([e, other])
    await session.flush()
    p1, p2 = _photo(e.id, org), _photo(e.id, org)
    foreign = _photo(other.id, org)
    session.add_all([p1, p2, foreign])
    await session.flush()

    # removing another entry's photo ids is rejected, nothing is removed
    with pytest.raises(APIError) as ex:
        await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(remove_photo_ids=[p1.id, foreign.id]),
                          session=session, member=_member(org, uid))
    assert ex.value.status_code == 422
    assert await session.get(JournalPhoto, p1.id) is not None

    await patch_entry(org_id=org, entry_id=e.id,
                      body=EntryPatch(remove_photo_ids=[p1.id, p2.id]),
                      session=session, member=_member(org, uid))
    remaining = (await session.execute(select(JournalPhoto).where(
        JournalPhoto.entry_id == e.id))).scalars().all()
    assert remaining == []
    assert set(fake_storage) == {p1.storage_path, p2.storage_path}
    # untouched sibling entry keeps its photo
    assert await session.get(JournalPhoto, foreign.id) is not None


async def test_journal_photo_edit_permission_preserved(session):
    org, uid, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    e = _entry(org, other)
    session.add(e)
    await session.flush()
    # a plain member can't photo-edit someone else's entry
    with pytest.raises(APIError) as ex:
        await patch_entry(org_id=org, entry_id=e.id,
                          body=EntryPatch(remove_photo_ids=[]),
                          session=session, member=_member(org, uid))
    assert ex.value.status_code == 403


# ── Movement photo replace / clear ──────────────────────────────────────

async def _doc_mv(session, org, mover):
    doc = Document(org_id=org, title="Paper", doc_type="concept_paper",
                   created_by=uuid.uuid4())
    session.add(doc)
    await session.flush()
    mv = DocumentMovement(org_id=org, document_id=doc.id, moved_by=mover,
                          location_text="SD office",
                          photo_path=f"{org}/uploads/old.jpg")
    session.add(mv)
    await session.flush()
    return doc, mv


async def test_movement_photo_replace_and_clear(session, fake_storage):
    org, uid = uuid.uuid4(), uuid.uuid4()
    doc, mv = await _doc_mv(session, org, uid)
    m = _member(org, uid, "officer")

    r = await patch_movement(org_id=org, doc_id=doc.id, movement_id=mv.id,
                             body=MovementPatch(photo_path=f"{org}/uploads/new.jpg"),
                             session=session, member=m)
    assert r["data"].photo_path == f"{org}/uploads/new.jpg"
    assert fake_storage == [f"{org}/uploads/old.jpg"]  # old object cleaned up

    r = await patch_movement(org_id=org, doc_id=doc.id, movement_id=mv.id,
                             body=MovementPatch(clear_photo=True),
                             session=session, member=m)
    assert r["data"].photo_path is None


async def test_movement_photo_conflict_and_foreign_path(session, fake_storage):
    org, uid = uuid.uuid4(), uuid.uuid4()
    doc, mv = await _doc_mv(session, org, uid)
    m = _member(org, uid, "officer")

    with pytest.raises(APIError) as e1:
        await patch_movement(org_id=org, doc_id=doc.id, movement_id=mv.id,
                             body=MovementPatch(photo_path=f"{org}/a.jpg", clear_photo=True),
                             session=session, member=m)
    assert e1.value.status_code == 422
    with pytest.raises(APIError) as e2:
        await patch_movement(org_id=org, doc_id=doc.id, movement_id=mv.id,
                             body=MovementPatch(photo_path=f"{uuid.uuid4()}/a.jpg"),
                             session=session, member=m)
    assert e2.value.status_code == 422


# ── Signatory revisions: return-to-step + pending carry ─────────────────

async def _route(session, org, doc, statuses):
    """steps A→B→C with the given statuses."""
    steps = [_step(org, doc.id, i, lbl, s) for i, (lbl, s) in enumerate(statuses)]
    session.add_all(steps)
    await session.flush()
    return steps


async def test_return_to_signed_step_mid_route(session):
    org, officer = uuid.uuid4(), uuid.uuid4()
    doc = Document(org_id=org, title="Letter", doc_type="letter",
                   status="in_progress", created_by=uuid.uuid4())
    session.add(doc)
    await session.flush()
    a, b, c = await _route(session, org, doc,
                           [("SSC President", "signed"),
                            ("Dean", "pending"),
                            ("OSA", "pending")])

    r = await request_revision(
        org_id=org, doc_id=doc.id,
        body=RevisionIn(return_to_step_id=a.id, note="fix the date",
                        resend_step_ids=[c.id]),   # carry OSA; Dean drops off
        session=session, member=_member(org, officer, "officer"))

    await session.refresh(a)
    assert a.status == "revision_requested" and a.note == "fix the date"
    # Dean's stale pending is superseded, not silently live
    await session.refresh(b)
    assert b.status == "superseded"
    # carried pending + returned step clone into round 2 as live pendings
    new = r["new_steps"]
    assert {s.label for s in new} == {"SSC President", "OSA"}
    assert all(s.status == "pending" and s.round_no == 2 for s in new)
    clone_a = next(s for s in new if s.label == "SSC President")
    assert clone_a.revises == a.id
    # history is intact — the original signed row still says signed-ish
    await session.refresh(c)
    assert c.status == "superseded"
    assert doc.status == "revision"


async def test_return_to_rejects_pending_and_unknown(session):
    org, officer = uuid.uuid4(), uuid.uuid4()
    doc = Document(org_id=org, title="Letter", doc_type="letter",
                   status="in_progress", created_by=uuid.uuid4())
    session.add(doc)
    await session.flush()
    a, b = await _route(session, org, doc,
                        [("President", "signed"), ("Dean", "pending")])
    m = _member(org, officer, "officer")

    # can't "return" to a step that hasn't resolved yet
    with pytest.raises(APIError) as e1:
        await request_revision(org_id=org, doc_id=doc.id,
                               body=RevisionIn(return_to_step_id=b.id, note="x"),
                               session=session, member=m)
    assert e1.value.status_code == 422
    # unknown step
    with pytest.raises(APIError) as e2:
        await request_revision(org_id=org, doc_id=doc.id,
                               body=RevisionIn(return_to_step_id=uuid.uuid4(), note="x"),
                               session=session, member=m)
    assert e2.value.status_code == 404
    # both triggers at once is ambiguous
    with pytest.raises(APIError) as e3:
        await request_revision(org_id=org, doc_id=doc.id,
                               body=RevisionIn(at_step_id=b.id, return_to_step_id=a.id,
                                               note="x"),
                               session=session, member=m)
    assert e3.value.code == "ONE_TRIGGER"


async def test_return_to_is_idempotent_for_already_carried(session):
    """The trigger step in resend_step_ids is deduped, not double-cloned."""
    org, officer = uuid.uuid4(), uuid.uuid4()
    doc = Document(org_id=org, title="Letter", doc_type="letter",
                   status="signed", created_by=uuid.uuid4())
    session.add(doc)
    await session.flush()
    a, = await _route(session, org, doc, [("President", "signed")])

    r = await request_revision(
        org_id=org, doc_id=doc.id,
        body=RevisionIn(return_to_step_id=a.id, note="again",
                        resend_step_ids=[a.id]),
        session=session, member=_member(org, officer, "officer"))
    assert len(r["new_steps"]) == 1


async def test_pending_trigger_still_works(session):
    """Regression: the original at_step flow is untouched."""
    org, officer = uuid.uuid4(), uuid.uuid4()
    doc = Document(org_id=org, title="Letter", doc_type="letter",
                   status="in_progress", created_by=uuid.uuid4())
    session.add(doc)
    await session.flush()
    a, b = await _route(session, org, doc,
                        [("President", "signed"), ("Dean", "pending")])

    r = await request_revision(
        org_id=org, doc_id=doc.id,
        body=RevisionIn(at_step_id=b.id, note="revise", resend_step_ids=[a.id]),
        session=session, member=_member(org, officer, "officer"))
    await session.refresh(b)
    assert b.status == "revision_requested"
    assert {s.label for s in r["new_steps"]} == {"President", "Dean"}
