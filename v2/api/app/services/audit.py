import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AuditLog


async def audit(
    session: AsyncSession,
    *,
    org_id: uuid.UUID,
    actor_id: str | uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Append an org-scoped audit row. Call on every sensitive mutation."""
    session.add(
        AuditLog(
            org_id=org_id,
            actor_id=uuid.UUID(actor_id) if actor_id else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata_=metadata or {},
        )
    )
