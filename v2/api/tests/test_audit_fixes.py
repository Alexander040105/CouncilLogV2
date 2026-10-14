"""Regression tests for the v2 audit fixes (AUDIT.md A1–A11).

Handler-level, sqlite in-memory, same harness as test_journal_paper_link.py.
Each test names the audit finding it pins down.
"""
import uuid
from datetime import timedelta

import jwt
import pytest
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlmodel import select


@compiles(JSONB, "sqlite")
def _jsonb_as_json(element, compiler, **kw):
    return "JSON"

from app import security
from app.config import get_settings
from app.deps import Membership
from app.errors import APIError
from app.models import (AuditLog, Document, DocumentMovement, JournalEntry,
                        JournalPhoto, OrgMember, Organization, Position,
                        Profile, Project, Task, TaskAssignee)
from app.pagination import org_today
from app.routers.daily import EntryIn, EntryPatch, create_entry, patch_entry
from app.routers.documents import list_documents
from app.routers.org_structure import PositionPatch, patch_position
from app.routers.tasks import list_tasks
from app.services import storage

TABLES = (Organization.__table__, Profile.__table__, OrgMember.__table__,
          Project.__table__, Document.__table__, DocumentMovement.__table__,
          Task.__table__, TaskAssignee.__table__,
          JournalEntry.__table__, JournalPhoto.__table__,
          Position.__table__, AuditLog.__table__)


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


@pytest.fixture
def fake_storage(monkeypatch):
    async def _head(path):
        return b"\xff\xd8\xff\xe0" + b"\x00" * 12
    monkeypatch.setattr(storage, "object_head", _head)


def _member(org_id, uid, role="member") -> Membership:
    return Membership(org_id=org_id, user_id=str(uid), role=role)


async def _org(session):
    org = Organization(name="Council", slug=f"o-{uuid.uuid4().hex[:8]}",
                       created_by=uuid.uuid4())
    session.add(org)
    await session.flush()
    return org


# ── A1: non-UUID sub → 401, not a downstream ValueError 500 ─────────────
@pytest.mark.asyncio
async def test_a1_token_with_non_uuid_sub_rejected_401(monkeypatch):
    async def _no_jwks():
        return None
    monkeypatch.setattr(security, "_jwks", _no_jwks)
    monkeypatch.setattr(get_settings(), "supabase_jwt_secret", "testsecret")
    tok = jwt.encode({"sub": "not-a-uuid", "aud": "authenticated"},
                     "testsecret", algorithm="HS256")
    with pytest.raises(APIError) as e:
        await security.verify_token(tok)
    assert e.value.status_code == 401


# ── A2: bad assignee/creator filter values → 422, not 500 ────────────────
@pytest.mark.asyncio
async def test_a2_bad_assignee_param_is_422(session):
    org = await _org(session)
    uid = uuid.uuid4()
    session.add(OrgMember(org_id=org.id, user_id=uid, role="owner", status="active"))
    await session.flush()
    m = _member(org.id, uid, role="owner")
    for kw in ({"assignee": "garbage"}, {"creator": "garbage"}):
        with pytest.raises(APIError) as e:
            await list_tasks(org_id=org.id, session=session, member=m, **kw)
        assert e.value.status_code == 422
    # 'me' still resolves
    r = await list_tasks(org_id=org.id, session=session, member=m,
                       assignee="me")
    assert r["data"] == []


# ── A3: malformed photo dicts → 422, not KeyError → 500 ──────────────────
@pytest.mark.asyncio
async def test_a3_bad_photo_dict_is_422(session):
    org = await _org(session)
    uid = uuid.uuid4()
    m = _member(org.id, uid)
    # (a non-dict element is rejected even earlier, by pydantic → 422)
    for bad in ({}, {"storage_path": f"{org.id}/uploads/x.jpg"},
                {"storage_path": f"{org.id}/uploads/x.jpg", "mime": "image/jpeg"},
                {"storage_path": f"{org.id}/x.jpg", "mime": "image/jpeg",
                 "byte_size": "big"}):
        with pytest.raises(APIError) as e:
            await create_entry(org_id=org.id, session=session, member=m,
                               body=EntryIn(description="d", photos=[bad]))
        assert e.value.status_code == 422


@pytest.mark.asyncio
async def test_a3_pdf_photo_rejected(session, fake_storage):
    # a file signed via the receipt path can't be attached as a journal photo
    org = await _org(session)
    uid = uuid.uuid4()
    m = _member(org.id, uid)
    with pytest.raises(APIError) as e:
        await create_entry(org_id=org.id, session=session, member=m,
                           body=EntryIn(description="d", photos=[{
                               "storage_path": f"{org.id}/receipts/x",
                               "mime": "application/pdf", "byte_size": 10}]))
    assert e.value.status_code == 422


# ── A4: future-dated dailies rejected ────────────────────────────────────
@pytest.mark.asyncio
async def test_a4_future_entry_date_is_422(session):
    org = await _org(session)
    with pytest.raises(APIError) as e:
        await create_entry(org_id=org.id, session=session,
                           member=_member(org.id, uuid.uuid4()),
                           body=EntryIn(description="d",
                                        entry_date=org_today() + timedelta(days=1)))
    assert e.value.status_code == 422
    assert e.value.code == "FUTURE_DAY"


# ── A5: patching in a paper inherits its project ─────────────────────────
@pytest.mark.asyncio
async def test_a5_doc_link_inherits_project_on_patch(session):
    org = await _org(session)
    uid = uuid.uuid4()
    p = Project(org_id=org.id, title="Fair", owner_id=uid)
    d = Document(org_id=org.id, project_id=p.id, title="Paper",
                 doc_type="concept_paper", created_by=uid)
    e = JournalEntry(org_id=org.id, member_id=uid, entry_date=org_today(),
                     description="did work")
    session.add_all([p, d, e])
    await session.flush()
    r = await patch_entry(org_id=org.id, entry_id=e.id, session=session,
                          member=_member(org.id, uid),
                          body=EntryPatch(document_id=d.id))
    assert r["data"].project_id == p.id


# ── A6: position patch is a real partial update ──────────────────────────
@pytest.mark.asyncio
async def test_a6_patch_position_partial_and_clear(session):
    org = await _org(session)
    uid = uuid.uuid4()
    session.add(OrgMember(org_id=org.id, user_id=uid, role="owner", status="active"))
    pos = Position(org_id=org.id, school_year_id=uuid.uuid4(), title="Treas",
                   rank=1, holder=uid, reports_to=uuid.uuid4())
    session.add(pos)
    await session.flush()
    m = _member(org.id, uid, role="owner")
    # partial: rank only, no title required
    r = await patch_position(org_id=org.id, position_id=pos.id, session=session,
                             member=m, body=PositionPatch(rank=5))
    assert r["data"].rank == 5 and r["data"].title == "Treas"
    # explicit null clears the seat + chart edge
    r = await patch_position(org_id=org.id, position_id=pos.id, session=session,
                             member=m,
                             body=PositionPatch(holder=None, reports_to=None))
    assert r["data"].holder is None and r["data"].reports_to is None
    # self-parent is rejected
    with pytest.raises(APIError) as e:
        await patch_position(org_id=org.id, position_id=pos.id, session=session,
                             member=m, body=PositionPatch(reports_to=pos.id))
    assert e.value.status_code == 422


# ── A7: held_by only supports 'me' ───────────────────────────────────────
@pytest.mark.asyncio
async def test_a7_held_by_rejects_unknown_values(session):
    org = await _org(session)
    m = _member(org.id, uuid.uuid4())
    with pytest.raises(APIError) as e:
        await list_documents(org_id=org.id, session=session,
                             held_by=str(uuid.uuid4()), member=m)
    assert e.value.status_code == 422
    # 'me' still works
    r = await list_documents(org_id=org.id, session=session,
                             held_by="me", member=m)
    assert r["data"] == []
