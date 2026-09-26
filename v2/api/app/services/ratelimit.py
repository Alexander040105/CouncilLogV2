"""Fixed-window rate limiting backed by Postgres — safe on serverless where
instances share no memory. Spec §8.10 endpoints; Upstash is the scale path."""

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import APIError
from ..models import RateLimit


async def check_rate_limit(
    session: AsyncSession, key: str, *, limit: int, window_seconds: int
) -> None:
    """Count this attempt in the current window; raise 429 past `limit`.

    Commits immediately so attempts count even when the request fails later.
    """
    now = datetime.now(timezone.utc)
    row = await session.get(RateLimit, key)
    if row is None:
        session.add(RateLimit(key=key, window_start=now, count=1))
    else:
        ws = row.window_start
        if ws.tzinfo is None:
            ws = ws.replace(tzinfo=timezone.utc)
        if (now - ws).total_seconds() >= window_seconds:
            row.window_start = now
            row.count = 1
        elif row.count >= limit:
            raise APIError(429, "RATE_LIMITED",
                           "Too many attempts — wait a few minutes and try again")
        else:
            row.count += 1
    await session.commit()
