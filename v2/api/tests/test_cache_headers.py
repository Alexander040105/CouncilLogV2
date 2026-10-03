"""Cache-tier mapping + the /me single-query merge.

cache_tier is pure — asserting the three freshness tiers per path shape is
the contract test for CacheHeadersMiddleware. /me is regression-tested at
the handler level: profile LEFT JOIN means zero-membership users and
archived-org members still get the same shape as before.
"""
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles


@compiles(JSONB, "sqlite")
def _jsonb_as_json(element, compiler, **kw):
    return "JSON"

from app.cache import cache_tier
from app.deps import CurrentUser
from app.models import OrgMember, Organization, Profile
from app.routers.core import me
from app.security import AuthUser

ORG_ID = uuid.uuid4()
V1 = "/api/v1"


def test_cache_tier_slow_config():
    for path in ("positions", "org-chart", "duty-schedule", "contacts",
                 "signatory-chains", "checklist-templates", "school-years"):
        assert cache_tier(f"{V1}/orgs/{ORG_ID}/{path}") == \
            "private, max-age=60, stale-while-revalidate=300", path


def test_cache_tier_lists():
    for path in ("projects", "documents", "tasks", "journal", "members"):
        assert cache_tier(f"{V1}/orgs/{ORG_ID}/{path}") == "private, max-age=10", path
    assert cache_tier(f"{V1}/orgs/{ORG_ID}") == "private, max-age=10"


def test_cache_tier_no_store():
    for path in ("notifications", "attendance", "attendance/summary",
                 "checklist-items", "audit", "documents/11111111-1111-1111-1111-111111111111",
                 "projects/11111111-1111-1111-1111-111111111111",
                 "photos/11111111-1111-1111-1111-111111111111/url"):
        assert cache_tier(f"{V1}/orgs/{ORG_ID}/{path}") == "no-store", path
    assert cache_tier(f"{V1}/me") == "no-store"
    assert cache_tier(f"{V1}/admin/orgs") == "no-store"
    assert cache_tier(f"{V1}/health") == "no-store"
    assert cache_tier(f"{V1}/anything-new") == "no-store"


TABLES = (Profile.__table__, Organization.__table__, OrgMember.__table__)


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


def _user(uid: uuid.UUID) -> CurrentUser:
    return AuthUser(id=str(uid), email="u@x.test", claims={})


@pytest.mark.asyncio
async def test_me_single_query_shape(session):
    uid, org_a, org_archived = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    session.add(Profile(id=uid, display_name="Pat"))
    session.add_all([
        Organization(id=org_a, name="Council", slug="council", created_by=uid),
        Organization(id=org_archived, name="Gone", slug="gone", created_by=uid,
                     archived_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc)),
        OrgMember(org_id=org_a, user_id=uid, role="member", status="active"),
        OrgMember(org_id=org_archived, user_id=uid, role="member", status="active"),
        OrgMember(org_id=org_a, user_id=uuid.uuid4(), role="owner", status="active"),
    ])
    await session.commit()
    r = await me(user=_user(uid), session=session)
    assert r["profile"].display_name == "Pat"
    assert [m["org_name"] for m in r["memberships"]] == ["Council"]  # archived excluded


@pytest.mark.asyncio
async def test_me_no_profile_no_memberships(session):
    r = await me(user=_user(uuid.uuid4()), session=session)
    assert r["profile"] is None and r["memberships"] == [] and r["is_admin"] is False
