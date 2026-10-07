import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from ..deps import CurrentUser, Membership, Session, authorize
from ..errors import APIError, not_found
from ..models import Invite, JoinRequest, OrgMember, Organization, Profile, SchoolYear
from ..pagination import envelope, page_params
from ..services.audit import audit
from ..services.notify import fan_out_join_decided, fan_out_join_request
from ..services.ratelimit import check_rate_limit

router = APIRouter(tags=["orgs"])


class OrgCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=2, max_length=60, pattern=r"^[a-z0-9-]+$")
    school_year_label: str = Field(min_length=4, max_length=40)


class OrgPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    logo_url: str | None = None


@router.post("/orgs", status_code=201)
async def create_org(body: OrgCreate, user: CurrentUser, session: Session):
    await check_rate_limit(session, f"orgcreate:{user.id}", limit=10, window_seconds=86400)
    exists = (await session.execute(select(Organization).where(Organization.slug == body.slug))).first()
    if exists:
        raise APIError(409, "SLUG_TAKEN", "That org slug is taken")
    uid = uuid.UUID(user.id)
    if await session.get(Profile, uid) is None:
        session.add(Profile(id=uid, display_name=user.email or "member"))
        await session.flush()  # profiles must exist before org_members FK insert
    org = Organization(name=body.name, slug=body.slug, created_by=uid)
    session.add(org)
    await session.flush()
    sy = SchoolYear(org_id=org.id, label=body.school_year_label, is_current=True)
    session.add(sy)
    session.add(OrgMember(org_id=org.id, user_id=uid, role="owner", status="active"))
    await audit(session, org_id=org.id, actor_id=user.id, action="org.created",
                entity_type="organization", entity_id=org.id)
    await session.commit()
    return {"id": str(org.id), "slug": org.slug, "role": "owner"}


@router.get("/orgs/{org_id}")
async def get_org(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    org = await session.get(Organization, org_id)
    if org is None:
        raise not_found("organization")
    return {"data": org, "my_role": member.role}


@router.patch("/orgs/{org_id}")
async def patch_org(org_id: uuid.UUID, body: OrgPatch, session: Session, member: Membership = Depends(authorize("owner"))):
    org = await session.get(Organization, org_id)
    if org is None:
        raise not_found("organization")
    if body.name is not None:
        org.name = body.name
    if body.logo_url is not None:
        org.logo_url = body.logo_url
    await audit(session, org_id=org_id, actor_id=member.user_id, action="org.updated",
                entity_type="organization", entity_id=org_id, metadata=body.model_dump(exclude_none=True))
    await session.commit()
    return {"data": org}


@router.post("/orgs/{org_id}/archive")
async def archive_org(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize("owner"))):
    """Soft delete — the org disappears for every member (authorize() → 404)
    but all data survives. Only a platform admin can restore it."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise not_found("organization")
    if org.archived_at is not None:
        raise APIError(409, "ALREADY_ARCHIVED", "This org is already archived")
    org.archived_at = datetime.now(timezone.utc)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="org.archived",
                entity_type="organization", entity_id=org_id)
    await session.commit()
    return {"data": {"id": str(org.id), "archived_at": org.archived_at}}


# ── Members ─────────────────────────────────────────────────────────────
@router.get("/orgs/{org_id}/members")
async def list_members(org_id: uuid.UUID, session: Session, page: int = 1, pageSize: int = 50, member: Membership = Depends(authorize())):
    page, page_size = page_params(page, pageSize)
    rows = (
        await session.execute(
            select(OrgMember, Profile)
            .join(Profile, Profile.id == OrgMember.user_id)
            .where(OrgMember.org_id == org_id)
            .offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    total = len((await session.execute(select(OrgMember).where(OrgMember.org_id == org_id))).all())
    return envelope(
        [{"user_id": str(m.user_id), "role": m.role, "status": m.status,
          "display_name": p.display_name, "avatar_url": p.avatar_url} for m, p in rows],
        page, page_size, total)


class MemberPatch(BaseModel):
    role: str | None = Field(default=None, pattern="^(adviser|officer|member)$")
    status: str | None = Field(default=None, pattern="^(active|removed)$")


@router.patch("/orgs/{org_id}/members/{user_id}")
async def patch_member(org_id: uuid.UUID, user_id: uuid.UUID, body: MemberPatch, session: Session, member: Membership = Depends(authorize("owner"))):
    target = await session.get(OrgMember, (org_id, user_id))
    if target is None:
        raise not_found("member")
    if str(user_id) == member.user_id and body.role is not None:
        raise APIError(422, "SELF_ROLE", "You cannot change your own role")
    if target.role == "owner" and (body.role is not None or body.status == "removed"):
        # an org can't be left ownerless — same invariant as DELETE /me
        other_owners = (await session.execute(
            select(func.count()).select_from(OrgMember).where(
                OrgMember.org_id == org_id,
                OrgMember.role == "owner",
                OrgMember.status == "active",
                OrgMember.user_id != user_id,
            )
        )).scalar_one()
        if other_owners == 0:
            raise APIError(409, "SOLE_OWNER",
                           "That's the only owner — hand off ownership or archive the org first")
    if body.role:
        target.role = body.role
    if body.status:
        target.status = body.status
    await audit(session, org_id=org_id, actor_id=member.user_id, action="member.updated",
                entity_type="org_member", entity_id=None,
                metadata={"target": str(user_id), **body.model_dump(exclude_none=True)})
    await session.commit()
    return {"data": {"user_id": str(user_id), "role": target.role, "status": target.status}}


# ── Invites ─────────────────────────────────────────────────────────────
class InviteCreate(BaseModel):
    role: str = Field(pattern="^(adviser|officer|member)$")
    expires_hours: int = Field(default=48, ge=1, le=720)
    max_uses: int = Field(default=500, ge=1, le=500)


@router.post("/orgs/{org_id}/invites", status_code=201)
async def mint_invite(org_id: uuid.UUID, body: InviteCreate, session: Session, member: Membership = Depends(authorize("owner"))):
    await check_rate_limit(session, f"invite:{member.user_id}", limit=20, window_seconds=3600)
    inv = Invite(
        org_id=org_id,
        code=secrets.token_urlsafe(16),
        role=body.role,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=body.expires_hours),
        max_uses=body.max_uses,
        created_by=uuid.UUID(member.user_id),
    )
    session.add(inv)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="invite.created",
                entity_type="invite", entity_id=inv.id, metadata={"role": body.role})
    await session.commit()
    return {"code": inv.code, "role": inv.role, "expires_at": inv.expires_at}


@router.get("/orgs/{org_id}/invites")
async def list_invites(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize("owner"))):
    rows = (await session.execute(
        select(Invite).where(Invite.org_id == org_id).order_by(
            Invite.created_at.desc()).limit(200))).scalars().all()
    return {"data": rows}


@router.post("/invites/{code}/redeem", status_code=201)
async def redeem_invite(code: str, user: CurrentUser, session: Session):
    await check_rate_limit(session, f"redeem:{user.id}", limit=20, window_seconds=3600)
    inv = (await session.execute(select(Invite).where(Invite.code == code))).scalars().first()
    if inv is None:
        raise not_found("invite")
    invite_org = await session.get(Organization, inv.org_id)
    if invite_org is None or invite_org.archived_at is not None:
        raise not_found("organization")  # archived orgs take no new members
    now = datetime.now(timezone.utc)
    if inv.expires_at < now or inv.uses >= inv.max_uses:
        raise APIError(410, "INVITE_EXPIRED", "Invite is expired or exhausted")
    uid = uuid.UUID(user.id)
    existing = await session.get(OrgMember, (inv.org_id, uid))
    if existing and existing.status == "active":
        raise APIError(409, "ALREADY_MEMBER", "You are already a member")
    if await session.get(Profile, uid) is None:
        session.add(Profile(id=uid, display_name=user.email or "member"))
        await session.flush()  # profiles must exist before org_members FK insert
    if existing:
        existing.role = inv.role
        existing.status = "active"
    else:
        session.add(OrgMember(org_id=inv.org_id, user_id=uid, role=inv.role, status="active"))
    inv.uses += 1
    await audit(session, org_id=inv.org_id, actor_id=user.id, action="invite.redeemed",
                entity_type="invite", entity_id=inv.id, metadata={"role": inv.role})
    await session.commit()
    return {"org_id": str(inv.org_id), "role": inv.role}


# ── Join requests ───────────────────────────────────────────────────────
class JoinReqCreate(BaseModel):
    message: str | None = Field(default=None, max_length=500)


@router.post("/orgs/{org_id}/join-requests", status_code=201)
async def request_join(org_id: uuid.UUID, body: JoinReqCreate, user: CurrentUser, session: Session, bg: BackgroundTasks):
    join_org = await session.get(Organization, org_id)
    if join_org is None or join_org.archived_at is not None:
        raise not_found("organization")  # archived orgs take no new members
    await check_rate_limit(session, f"joinreq:{user.id}", limit=10, window_seconds=900)
    uid = uuid.UUID(user.id)
    m = await session.get(OrgMember, (org_id, uid))
    if m and m.status == "active":
        raise APIError(409, "ALREADY_MEMBER", "You are already a member")
    existing = (await session.execute(
        select(JoinRequest).where(JoinRequest.org_id == org_id, JoinRequest.user_id == uid))).scalars().first()
    if existing and existing.status == "pending":
        raise APIError(409, "REQUEST_PENDING", "A join request is already pending")
    if await session.get(Profile, uid) is None:
        session.add(Profile(id=uid, display_name=user.email or "member"))
        await session.flush()  # profiles must exist before join_requests FK insert
    if existing:
        existing.status = "pending"
        existing.message = body.message
        existing.decided_by = existing.decided_at = None
        jr = existing
    else:
        jr = JoinRequest(org_id=org_id, user_id=uid, message=body.message)
        session.add(jr)
    requester = await session.get(Profile, uid)
    await fan_out_join_request(
        session, bg, org_id=org_id, requester_id=str(uid),
        requester_name=(requester.display_name if requester else None)
        or user.email or "Someone")
    await session.commit()
    return {"data": jr}


@router.get("/orgs/{org_id}/join-requests")
async def list_join_requests(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize("owner"))):
    rows = (await session.execute(
        select(JoinRequest, Profile)
        .join(Profile, Profile.id == JoinRequest.user_id)
        .where(JoinRequest.org_id == org_id, JoinRequest.status == "pending"))).all()
    return {"data": [
        {"id": str(j.id), "user_id": str(j.user_id), "message": j.message,
         "display_name": p.display_name, "created_at": j.created_at}
        for j, p in rows]}


class DecideBody(BaseModel):
    approve: bool
    role: str = Field(default="member", pattern="^(adviser|officer|member)$")


@router.post("/orgs/{org_id}/join-requests/{request_id}/decide")
async def decide_join(org_id: uuid.UUID, request_id: uuid.UUID, body: DecideBody, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize("owner"))):
    jr = await session.get(JoinRequest, request_id)
    if jr is None or jr.org_id != org_id:
        raise not_found("join request")
    if jr.status != "pending":
        raise APIError(409, "ALREADY_DECIDED", "Request already decided")
    now = datetime.now(timezone.utc)
    jr.status = "approved" if body.approve else "rejected"
    jr.decided_by = uuid.UUID(member.user_id)
    jr.decided_at = now
    if body.approve:
        existing = await session.get(OrgMember, (org_id, jr.user_id))
        if existing:
            existing.role = body.role
            existing.status = "active"
        else:
            session.add(OrgMember(org_id=org_id, user_id=jr.user_id, role=body.role, status="active"))
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action=f"join_request.{jr.status}", entity_type="join_request",
                entity_id=jr.id, metadata={"target": str(jr.user_id), "role": body.role})
    await fan_out_join_decided(session, bg, org_id=org_id,
                               user_id=jr.user_id, actor_id=member.user_id,
                               approved=body.approve)
    await session.commit()
    return {"data": {"id": str(jr.id), "status": jr.status}}
