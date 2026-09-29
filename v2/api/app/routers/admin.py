"""Platform-admin endpoints — org-less, gated by profiles.is_admin.

Org-scoped work still goes through the normal /orgs/* routes (authorize()
grants admins owner powers); these routes cover what has no org context:
listing every org and restoring archived ones.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlmodel import select

from ..deps import Session, require_platform_admin
from ..errors import APIError, not_found
from ..models import OrgMember, Organization
from ..pagination import envelope, page_params
from ..security import AuthUser
from ..services.audit import audit

router = APIRouter(tags=["admin"])

Admin = Annotated[AuthUser, Depends(require_platform_admin)]


@router.get("/admin/orgs")
async def list_all_orgs(session: Session, _admin: Admin, page: int = 1, pageSize: int = 50):
    page, page_size = page_params(page, pageSize)
    member_count = (
        select(OrgMember.org_id, func.count().label("member_count"))
        .where(OrgMember.status == "active")
        .group_by(OrgMember.org_id)
        .subquery()
    )
    rows = (
        await session.execute(
            select(Organization, func.coalesce(member_count.c.member_count, 0))
            .outerjoin(member_count, member_count.c.org_id == Organization.id)
            .order_by(Organization.created_at.desc())
            .offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    total = len((await session.execute(select(Organization))).all())
    return envelope(
        [{"id": str(o.id), "name": o.name, "slug": o.slug,
          "archived_at": o.archived_at, "created_at": o.created_at,
          "member_count": n} for o, n in rows],
        page, page_size, total)


@router.post("/admin/orgs/{org_id}/restore")
async def restore_org(org_id: uuid.UUID, admin: Admin, session: Session):
    org = await session.get(Organization, org_id)
    if org is None:
        raise not_found("organization")
    if org.archived_at is None:
        raise APIError(409, "NOT_ARCHIVED", "This org is not archived")
    org.archived_at = None
    await audit(session, org_id=org_id, actor_id=admin.id, action="org.restored",
                entity_type="organization", entity_id=org_id)
    await session.commit()
    return {"data": {"id": str(org.id), "archived_at": None}}
