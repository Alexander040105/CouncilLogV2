"""In-app notification inbox + Expo push-token registration.

Inbox rows are written inside the assigning request's transaction (see
notify.record_notification); these routes only read/mark them. Push tokens
are user-scoped — a device token is unique and follows the signed-in user
(handoff: a token re-registered under a different user reassignment wins).
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from ..deps import Membership, Session, authorize
from ..errors import not_found
from ..models import Notification, PushToken

router = APIRouter(tags=["notifications"])


@router.get("/orgs/{org_id}/notifications")
async def list_notifications(org_id: uuid.UUID, session: Session,
                             unread: bool | None = None, limit: int = 50,
                             member: Membership = Depends(authorize())):
    """The bell's data: recent rows + an always-accurate unread count so a
    filtered list can't hide that there's still unseen stuff."""
    uid = uuid.UUID(member.user_id)
    q = select(Notification).where(Notification.org_id == org_id,
                                   Notification.user_id == uid)
    if unread:
        q = q.where(Notification.read_at == None)  # noqa: E711
    rows = (await session.execute(
        q.order_by(Notification.created_at.desc())
         .limit(min(max(limit, 1), 100)))).scalars().all()
    unread_count = (await session.execute(
        select(func.count()).where(Notification.org_id == org_id,
                                   Notification.user_id == uid,
                                   Notification.read_at == None))).scalar_one()  # noqa: E711
    return {"data": rows, "unread": unread_count}


class MarkRead(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


@router.post("/orgs/{org_id}/notifications/read")
async def mark_read(org_id: uuid.UUID, body: MarkRead, session: Session,
                    member: Membership = Depends(authorize())):
    uid = uuid.UUID(member.user_id)
    rows = (await session.execute(select(Notification).where(
        Notification.org_id == org_id, Notification.user_id == uid,
        Notification.id.in_(body.ids), Notification.read_at == None))  # noqa: E711
    ).scalars().all()
    now = datetime.now(timezone.utc)
    for n in rows:
        n.read_at = now
    await session.commit()
    return {"data": {"read": len(rows)}}


@router.post("/orgs/{org_id}/notifications/read-all")
async def mark_all_read(org_id: uuid.UUID, session: Session,
                        member: Membership = Depends(authorize())):
    uid = uuid.UUID(member.user_id)
    rows = (await session.execute(select(Notification).where(
        Notification.org_id == org_id, Notification.user_id == uid,
        Notification.read_at == None))).scalars().all()  # noqa: E711
    now = datetime.now(timezone.utc)
    for n in rows:
        n.read_at = now
    await session.commit()
    return {"data": {"read": len(rows)}}


class TokenIn(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    platform: str = Field(pattern="^(android|ios)$")


@router.post("/orgs/{org_id}/push-tokens", status_code=201)
async def register_push_token(org_id: uuid.UUID, body: TokenIn, session: Session,
                              member: Membership = Depends(authorize("member"))):
    uid = uuid.UUID(member.user_id)
    t = (await session.execute(
        select(PushToken).where(PushToken.token == body.token))).scalars().first()
    now = datetime.now(timezone.utc)
    if t is None:
        t = PushToken(user_id=uid, token=body.token, platform=body.platform)
        session.add(t)
    else:
        # same physical device, possibly a different sign-in — current user wins
        t.user_id = uid
        t.platform = body.platform
        t.last_seen_at = now
    await session.commit()
    return {"data": {"registered": True}}


class TokenDelete(BaseModel):
    token: str = Field(min_length=1, max_length=200)


@router.delete("/orgs/{org_id}/push-tokens")
async def delete_push_token(org_id: uuid.UUID, body: TokenDelete, session: Session,
                            member: Membership = Depends(authorize("member"))):
    """Body not path — Expo tokens contain [] which are hostile in URLs."""
    t = (await session.execute(select(PushToken).where(
        PushToken.token == body.token,
        PushToken.user_id == uuid.UUID(member.user_id)))).scalars().first()
    if t is None:
        raise not_found("push token")
    await session.delete(t)
    await session.commit()
    return {"data": {"deleted": True}}
