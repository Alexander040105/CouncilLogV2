from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import get_settings

settings = get_settings()
# Supabase transaction pooler (pgbouncer) doesn't support prepared statements —
# disable asyncpg's statement cache when pointed at a pooler.
# pool_pre_ping costs a SELECT 1 round-trip on EVERY request (~0.5s to the
# pooler from serverless); pool_recycle drops connections before the pooler's
# idle reaper does, which is the dominant staleness source on Vercel.
_is_pooler = "pooler.supabase.com" in settings.database_url
engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=False,
    pool_recycle=180,
    connect_args={"statement_cache_size": 0} if _is_pooler else {},
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
