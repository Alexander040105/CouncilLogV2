import uuid
from datetime import date

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import select

from app.models import AttendanceDay, DutySchedule, SchoolYear
from app.routers.daily import _upsert_attendance

# Regression for the launch-audit finding: the attendance upsert originally
# keyed only on (member_id, day) — a member of two orgs filing in org B hit
# org A's row (silent no-op) or 409'd on the unique constraint.


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in (AttendanceDay.__table__, SchoolYear.__table__, DutySchedule.__table__):
            await conn.run_sync(t.create)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def test_same_member_two_orgs_same_day(session):
    org_a, org_b = uuid.uuid4(), uuid.uuid4()
    member = uuid.uuid4()
    today = date(2026, 9, 26)

    ra = await _upsert_attendance(session, org_a, member, today, "documented")
    rb = await _upsert_attendance(session, org_b, member, today, "declared_no_tasks")
    await session.commit()

    rows = (await session.execute(select(AttendanceDay))).scalars().all()
    assert len(rows) == 2
    assert ra.org_id == org_a and ra.status == "documented"
    assert rb.org_id == org_b and rb.status == "declared_no_tasks"


async def test_documented_beats_declared_same_org(session):
    org, member = uuid.uuid4(), uuid.uuid4()
    today = date(2026, 9, 26)

    await _upsert_attendance(session, org, member, today, "declared_no_tasks")
    r = await _upsert_attendance(session, org, member, today, "documented")
    assert r.status == "documented"

    # and documented is sticky — a later no-tasks can't downgrade it
    r2 = await _upsert_attendance(session, org, member, today, "declared_no_tasks")
    assert r2.status == "documented"
