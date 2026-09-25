import uuid

from fastapi import APIRouter
from sqlmodel import select

from ..deps import CurrentUser, Session
from ..models import OrgMember, Organization, Profile

router = APIRouter(tags=["core"])


@router.get("/health")
async def health() -> dict:
    return {"ok": True}


@router.get("/me")
async def me(user: CurrentUser, session: Session) -> dict:
    profile = await session.get(Profile, uuid.UUID(user.id))
    rows = (
        await session.execute(
            select(OrgMember, Organization)
            .join(Organization, Organization.id == OrgMember.org_id)
            .where(OrgMember.user_id == uuid.UUID(user.id), OrgMember.status == "active")
        )
    ).all()
    return {
        "id": user.id,
        "email": user.email,
        "profile": profile,
        "memberships": [
            {"org_id": str(o.id), "org_name": o.name, "slug": o.slug, "role": m.role}
            for m, o in rows
        ],
    }
