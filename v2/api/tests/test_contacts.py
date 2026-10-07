"""Contacts directory: CRUD + cross-org 404. Handler-level like
test_finance.py — constructed Membership, sqlite in-memory. Role gating
(owner-only writes) lives in the authorize() dependency, covered in
test_admin.py."""
import uuid

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
from app.models import AuditLog, OrgContact, Organization
from app.routers.org_structure import (ContactIn, ContactPatch, create_contact,
                                       delete_contact, list_contacts, patch_contact)

TABLES = (OrgContact.__table__, Organization.__table__, AuditLog.__table__)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in TABLES:
            await conn.run_sync(t.create)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


def _member(org_id, uid, role="member") -> Membership:
    return Membership(org_id=org_id, user_id=str(uid), role=role)


def _org() -> Organization:
    return Organization(name="Org", slug=f"org-{uuid.uuid4().hex[:6]}",
                        created_by=uuid.uuid4())


async def _contact(session, org_id, uid, label="Venue bookings"):
    r = await create_contact(org_id, ContactIn(label=label, value="Facilities office"),
                             session, _member(org_id, uid, "owner"))
    return r["data"]


@pytest.mark.asyncio
async def test_create_and_list(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    await session.commit()
    c = await _contact(session, org.id, uid)
    rows = (await list_contacts(org.id, session, _member(org.id, uuid.uuid4())))["data"]
    assert [r.id for r in rows] == [c.id]


@pytest.mark.asyncio
async def test_patch_updates_fields(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    await session.commit()
    c = await _contact(session, org.id, uid)
    r = await patch_contact(org.id, c.id,
                            ContactPatch(label="Room bookings", category="Places"),
                            session, _member(org.id, uid, "owner"))
    assert r["data"].label == "Room bookings"
    assert r["data"].category == "Places"
    assert r["data"].value == "Facilities office"  # untouched field survives


@pytest.mark.asyncio
async def test_patch_clears_category(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    await session.commit()
    c = await _contact(session, org.id, uid)
    c.category = "Places"
    await session.commit()
    r = await patch_contact(org.id, c.id, ContactPatch(category=None),
                            session, _member(org.id, uid, "owner"))
    assert r["data"].category is None


@pytest.mark.asyncio
async def test_delete_removes_row(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    await session.commit()
    c = await _contact(session, org.id, uid)
    await delete_contact(org.id, c.id, session, _member(org.id, uid, "owner"))
    rows = (await session.execute(select(OrgContact))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_cross_org_returns_404(session):
    org_a, org_b, uid = _org(), _org(), uuid.uuid4()
    session.add_all([org_a, org_b])
    await session.commit()
    c = await _contact(session, org_a.id, uid)
    owner_b = _member(org_b.id, uid, "owner")
    with pytest.raises(APIError) as e:
        await patch_contact(org_b.id, c.id, ContactPatch(label="x"), session, owner_b)
    assert e.value.status_code == 404
    with pytest.raises(APIError) as e:
        await delete_contact(org_b.id, c.id, session, owner_b)
    assert e.value.status_code == 404
