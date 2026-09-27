import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.errors import APIError
from app.models import RateLimit
from app.services.ratelimit import check_rate_limit


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: RateLimit.__table__.create(c))
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def test_allows_within_limit(session):
    for _ in range(3):
        await check_rate_limit(session, "k", limit=3, window_seconds=60)


async def test_blocks_at_limit(session):
    for _ in range(3):
        await check_rate_limit(session, "k", limit=3, window_seconds=60)
    with pytest.raises(APIError) as e:
        await check_rate_limit(session, "k", limit=3, window_seconds=60)
    assert e.value.status_code == 429 and e.value.code == "RATE_LIMITED"


async def test_window_rollover_resets(session):
    await check_rate_limit(session, "k", limit=1, window_seconds=60)
    with pytest.raises(APIError):
        await check_rate_limit(session, "k", limit=1, window_seconds=60)
    # backdate the window directly, then the next call must pass
    from datetime import datetime, timedelta, timezone

    from app.models import RateLimit
    row = await session.get(RateLimit, "k")
    row.window_start = datetime.now(timezone.utc) - timedelta(seconds=3600)
    await session.commit()
    await check_rate_limit(session, "k", limit=1, window_seconds=60)


async def test_keys_are_independent(session):
    await check_rate_limit(session, "a", limit=1, window_seconds=60)
    await check_rate_limit(session, "b", limit=1, window_seconds=60)
    with pytest.raises(APIError):
        await check_rate_limit(session, "a", limit=1, window_seconds=60)
