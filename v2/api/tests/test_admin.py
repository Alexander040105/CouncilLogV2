import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.deps import authorize, is_platform_admin, require_platform_admin
from app.errors import APIError
from app.models import OrgMember, Organization, Profile
from app.security import AuthUser


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in (Organization.__table__, Profile.__table__, OrgMember.__table__):
            await conn.run_sync(t.create)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


def _user(uid: uuid.UUID, email: str = "u@example.com") -> AuthUser:
    return AuthUser(id=str(uid), email=email, claims={})


async def _make_org(session, *, archived=False) -> Organization:
    org = Organization(name="Test Org", slug=f"org-{uuid.uuid4().hex[:8]}", created_by=uuid.uuid4())
    if archived:
        org.archived_at = datetime.now(timezone.utc)
    session.add(org)
    await session.flush()
    return org


async def test_is_platform_admin(session):
    uid = uuid.uuid4()
    assert not await is_platform_admin(session, _user(uid))  # no profile at all
    session.add(Profile(id=uid, display_name="Admin", is_admin=True))
    await session.flush()
    assert await is_platform_admin(session, _user(uid))


async def test_require_platform_admin(session):
    uid = uuid.uuid4()
    with pytest.raises(APIError) as e:
        await require_platform_admin(session, _user(uid))
    assert e.value.status_code == 403
    session.add(Profile(id=uid, display_name="Admin", is_admin=True))
    await session.flush()
    assert (await require_platform_admin(session, _user(uid))).id == str(uid)


async def test_admin_bypasses_membership_and_min_role(session):
    """Admins act as owner in an org they don't even belong to."""
    uid, org = uuid.uuid4(), await _make_org(session)
    session.add(Profile(id=uid, display_name="Admin", is_admin=True))
    await session.flush()

    dep = authorize("owner")
    m = await dep(org_id=org.id, session=session, user=_user(uid), x_org_id=None)
    assert m.role == "owner" and m.org_id == org.id


async def test_non_member_still_404s(session):
    uid, org = uuid.uuid4(), await _make_org(session)
    dep = authorize("member")
    with pytest.raises(APIError) as e:
        await dep(org_id=org.id, session=session, user=_user(uid), x_org_id=None)
    assert e.value.status_code == 404


async def test_archived_org_invisible_to_members(session):
    """Membership rows survive archiving, but members get the same 404 as
    outsiders — the org has vanished from their world."""
    uid, org = uuid.uuid4(), await _make_org(session, archived=True)
    session.add(Profile(id=uid, display_name="Member"))
    session.add(OrgMember(org_id=org.id, user_id=uid, role="owner", status="active"))
    await session.flush()

    dep = authorize("owner")
    with pytest.raises(APIError) as e:
        await dep(org_id=org.id, session=session, user=_user(uid), x_org_id=None)
    assert e.value.status_code == 404


async def test_admin_reaches_archived_org(session):
    uid, org = uuid.uuid4(), await _make_org(session, archived=True)
    session.add(Profile(id=uid, display_name="Admin", is_admin=True))
    await session.flush()

    dep = authorize("owner")
    m = await dep(org_id=org.id, session=session, user=_user(uid), x_org_id=None)
    assert m.role == "owner"


async def test_x_org_id_seatbelt(session):
    """Members can't lie about org context; admins can (they're cross-org)."""
    uid, org = uuid.uuid4(), await _make_org(session)
    session.add(Profile(id=uid, display_name="Member"))
    session.add(OrgMember(org_id=org.id, user_id=uid, role="member", status="active"))
    await session.flush()

    dep = authorize("member")
    with pytest.raises(APIError) as e:
        await dep(org_id=org.id, session=session, user=_user(uid), x_org_id=str(uuid.uuid4()))
    assert e.value.status_code == 403

    admin_uid = uuid.uuid4()
    session.add(Profile(id=admin_uid, display_name="Admin", is_admin=True))
    await session.flush()
    m = await dep(org_id=org.id, session=session, user=_user(admin_uid), x_org_id=str(uuid.uuid4()))
    assert m.role == "owner"


async def test_min_role_still_enforced_for_members(session):
    uid, org = uuid.uuid4(), await _make_org(session)
    session.add(Profile(id=uid, display_name="Member"))
    session.add(OrgMember(org_id=org.id, user_id=uid, role="member", status="active"))
    await session.flush()

    dep = authorize("owner")
    with pytest.raises(APIError) as e:
        await dep(org_id=org.id, session=session, user=_user(uid), x_org_id=None)
    assert e.value.status_code == 403
