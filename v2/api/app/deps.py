"""Shared dependencies: authenticated user + the single authorization
chokepoint. EVERY org-scoped route must resolve through authorize() —
see spec §8.1. Nothing trusts client-supplied role claims."""

from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from .db import get_session
from .errors import APIError, forbidden
from .models import OrgMember
from .security import AuthUser, verify_token

ROLE_RANK = {"member": 0, "officer": 1, "adviser": 2, "owner": 3}


@dataclass
class Membership:
    org_id: UUID
    user_id: str
    role: str

    def at_least(self, role: str) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[role]


async def get_current_user(authorization: Annotated[str | None, Header()] = None) -> AuthUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise APIError(401, "UNAUTHENTICATED", "Missing bearer token")
    return verify_token(authorization.removeprefix("Bearer ").strip())


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
Session = Annotated[AsyncSession, Depends(get_session)]


async def _membership(session: AsyncSession, org_id: UUID, user_id: str) -> OrgMember | None:
    row = await session.get(OrgMember, (org_id, UUID(user_id)))
    return row


def authorize(min_role: str = "member"):
    """Route dependency factory: resolves org membership for the caller.

    Usage:  member: Membership = Depends(authorize("officer"))
    Path must contain {org_id}.
    """

    async def dep(
        org_id: UUID,
        session: Session,
        user: CurrentUser,
        x_org_id: Annotated[str | None, Header()] = None,
    ) -> Membership:
        if x_org_id and x_org_id != str(org_id):
            raise forbidden("Org context mismatch")
        m = await _membership(session, org_id, user.id)
        if m is None or m.status != "active":
            # 404 over 403 — don't confirm the org exists to outsiders
            raise APIError(404, "NOT_FOUND", "Organization not found")
        if not m.role or ROLE_RANK[m.role] < ROLE_RANK[min_role]:
            raise forbidden(f"Requires role ≥ {min_role}")
        return Membership(org_id=org_id, user_id=user.id, role=m.role)

    return dep


async def require_user_in_org(session: AsyncSession, org_id: UUID, user_id: str) -> OrgMember:
    """Non-route helper: assert some OTHER user is an active member of the org."""
    m = await session.get(OrgMember, (org_id, UUID(user_id)))
    if m is None or m.status != "active":
        raise APIError(422, "NOT_A_MEMBER", "Target user is not an active member of this org")
    return m
