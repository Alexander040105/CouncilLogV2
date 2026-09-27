import uuid

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlmodel import select

from ..config import get_settings
from ..deps import CurrentUser, Session
from ..errors import APIError
from ..models import OrgMember, Organization, Profile
from ..services import auth_admin, storage
from ..services.audit import audit

router = APIRouter(tags=["core"])


@router.get("/health")
async def health() -> dict:
    return {"ok": True}


def _avatar_url_prefix(uid: uuid.UUID) -> str:
    s = get_settings()
    return f"{s.supabase_url.rstrip('/')}/storage/v1/object/public/{s.avatars_bucket}/{uid}/"


def _avatar_object_path(url: str, uid: uuid.UUID) -> str:
    """Object path inside the avatars bucket for a previously accepted URL."""
    return f"{uid}/{url.removeprefix(_avatar_url_prefix(uid))}"


def _validate_avatar_url(url: str | None, uid: uuid.UUID) -> None:
    """Avatars must be this account's uploaded objects — no arbitrary URLs."""
    if url is not None and not url.startswith(_avatar_url_prefix(uid)):
        raise APIError(422, "BAD_AVATAR_URL",
                       "avatar_url must point to an avatar uploaded via /me/avatar/sign")


async def _active_memberships(session, uid: uuid.UUID) -> list[OrgMember]:
    return [
        m for (m,) in (await session.execute(
            select(OrgMember).where(OrgMember.user_id == uid, OrgMember.status == "active")
        )).all()
    ]


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


class MePatch(BaseModel):
    # allowlist: display_name + avatar_url only — role/org/status can never
    # be written through this endpoint (extra keys → 422).
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    avatar_url: str | None = None


@router.patch("/me")
async def patch_me(body: MePatch, user: CurrentUser, session: Session) -> dict:
    uid = uuid.UUID(user.id)
    fields = body.model_fields_set
    changed: list[str] = []
    old_avatar_url: str | None = None

    profile = await session.get(Profile, uid)
    if profile is None:
        # no org joined yet → no profile row; lazily create like orgs.py does
        profile = Profile(id=uid, display_name=user.email or "member")
        session.add(profile)
        await session.flush()

    if "display_name" in fields:
        name = (body.display_name or "").strip()
        if not 1 <= len(name) <= 80:
            raise APIError(422, "BAD_NAME", "Display name must be 1–80 characters")
        if name != profile.display_name:
            profile.display_name = name
            changed.append("display_name")

    if "avatar_url" in fields:
        _validate_avatar_url(body.avatar_url, uid)
        if body.avatar_url != profile.avatar_url:
            old_avatar_url = profile.avatar_url
            profile.avatar_url = body.avatar_url
            changed.append("avatar_url")

    if changed:
        # audit once per org the user belongs to — each org's trail shows the rename
        for m in await _active_memberships(session, uid):
            await audit(session, org_id=m.org_id, actor_id=user.id,
                        action="profile.updated", entity_type="profile", entity_id=uid,
                        metadata={"fields": changed})
    await session.commit()

    if old_avatar_url and old_avatar_url.startswith(_avatar_url_prefix(uid)):
        await storage.delete_object(_avatar_object_path(old_avatar_url, uid),
                                    bucket=get_settings().avatars_bucket)
    return {"data": profile}


class AvatarSign(BaseModel):
    mime: str
    byte_size: int = Field(gt=0, le=5 * 1024 * 1024)


@router.post("/me/avatar/sign", status_code=201)
async def sign_avatar(body: AvatarSign, user: CurrentUser) -> dict:
    """Mint a signed upload URL for a new avatar. Client PUTs bytes to
    upload_url, then PATCHes /me with public_url."""
    storage.validate_upload_declared(body.mime, body.byte_size)
    uid = uuid.UUID(user.id)
    path = f"{uid}/{uuid.uuid4()}"
    bucket = get_settings().avatars_bucket
    return {
        "path": path,
        "upload_url": await storage.signed_upload_url(path, bucket=bucket),
        "public_url": storage.public_object_url(path, bucket=bucket),
    }


@router.delete("/me")
async def delete_me(user: CurrentUser, session: Session) -> dict:
    """Account removal = anonymize + soft-remove + ban. NOT a hard delete:
    org_members and the journal/attendance/duty FKs reference profiles, so
    deleting the auth user would orphan history. Soft removal preserves the
    audit trail while ending all access."""
    uid = uuid.UUID(user.id)
    rows = (
        await session.execute(
            select(OrgMember, Organization)
            .join(Organization, Organization.id == OrgMember.org_id)
            .where(OrgMember.user_id == uid)
        )
    ).all()

    # an org can't be left ownerless — refuse until they delete it or hand off
    blocked = []
    for m, o in rows:
        if m.role != "owner" or m.status != "active":
            continue
        other_owners = (await session.execute(
            select(func.count()).select_from(OrgMember).where(
                OrgMember.org_id == m.org_id,
                OrgMember.role == "owner",
                OrgMember.status == "active",
                OrgMember.user_id != uid,
            )
        )).scalar_one()
        if other_owners == 0:
            blocked.append(o.name)
    if blocked:
        raise APIError(
            409, "SOLE_OWNER",
            f"You're the sole owner of {', '.join(blocked)} — delete the org or hand off ownership first",
            details={"orgs": blocked},
        )

    profile = await session.get(Profile, uid)
    old_avatar_url = profile.avatar_url if profile else None
    for m, _ in rows:
        if m.status != "removed":
            m.status = "removed"
            await audit(session, org_id=m.org_id, actor_id=user.id,
                        action="account.deleted", entity_type="profile", entity_id=uid)
    if profile is not None:
        profile.display_name = "Former member"
        profile.avatar_url = None
    await session.commit()

    if old_avatar_url and old_avatar_url.startswith(_avatar_url_prefix(uid)):
        await storage.delete_object(_avatar_object_path(old_avatar_url, uid),
                                    bucket=get_settings().avatars_bucket)
    banned = await auth_admin.ban_user(uid)
    return {"data": {"deleted": True, "banned": banned}}
