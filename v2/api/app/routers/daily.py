import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from ..deps import Membership, Session, authorize, require_user_in_org
from ..errors import APIError, not_found
from ..models import (AttendanceDay, DutySchedule, JournalEntry, JournalPhoto,
                      OrgMember, Profile, Project, SchoolYear)
from ..pagination import envelope, org_today, page_params
from ..services.audit import audit
from ..services import storage
from ..services.ratelimit import check_rate_limit

router = APIRouter(tags=["daily"])


async def _duty_type(session, org_id: uuid.UUID, member_id: uuid.UUID, day: date) -> str:
    """scheduled if member is on that weekday's roster for the current SY."""
    sy = (await session.execute(select(SchoolYear).where(
        SchoolYear.org_id == org_id, SchoolYear.is_current == True))).scalars().first()  # noqa: E712
    if sy is None:
        return "extra"
    weekday = (day.weekday())  # python: Mon=0..Sun=6 — matches schema
    hit = (await session.execute(select(DutySchedule).where(
        DutySchedule.org_id == org_id,
        DutySchedule.school_year_id == sy.id,
        DutySchedule.weekday == weekday,
        DutySchedule.member_id == member_id))).scalars().first()
    return "scheduled" if hit else "extra"


async def _upsert_attendance(session, org_id: uuid.UUID, member_id: uuid.UUID, day: date, status: str) -> AttendanceDay:
    row = (await session.execute(select(AttendanceDay).where(
        AttendanceDay.org_id == org_id,
        AttendanceDay.member_id == member_id, AttendanceDay.day == day))).scalars().first()
    if row is None:
        row = AttendanceDay(org_id=org_id, member_id=member_id, day=day,
                            status=status, duty_type=await _duty_type(session, org_id, member_id, day))
        session.add(row)
    else:
        # documented beats declared_no_tasks if a journal entry arrives after a declaration
        if status == "documented" or row.status != "documented":
            row.status = status
        row.updated_at = datetime.now(timezone.utc)
    return row


# ── Journal ──────────────────────────────────────────────────────────────
class PhotoSign(BaseModel):
    mime: str
    byte_size: int = Field(gt=0, le=5 * 1024 * 1024)


@router.post("/orgs/{org_id}/journal/photos/sign", status_code=201)
async def sign_photo(org_id: uuid.UUID, body: PhotoSign, session: Session, member: Membership = Depends(authorize("member"))):
    await check_rate_limit(session, f"photosign:{member.user_id}", limit=60, window_seconds=3600)
    storage.validate_upload_declared(body.mime, body.byte_size)
    entry_hint = uuid.uuid4()
    path = f"{org_id}/uploads/{entry_hint}"
    url = await storage.signed_upload_url(path)
    return {"path": path, "upload_url": url}


class EntryIn(BaseModel):
    entry_date: date | None = None
    description: str = Field(min_length=1, max_length=4000)
    project_id: uuid.UUID | None = None
    photos: list[dict] = []  # [{storage_path, mime, byte_size}]


@router.post("/orgs/{org_id}/journal", status_code=201)
async def create_entry(org_id: uuid.UUID, body: EntryIn, session: Session, member: Membership = Depends(authorize("member"))):
    day = body.entry_date or org_today()
    uid = uuid.UUID(member.user_id)
    if body.project_id:
        proj = await session.get(Project, body.project_id)
        if proj is None or proj.org_id != org_id:
            raise not_found("project")
    entry = JournalEntry(org_id=org_id, member_id=uid, entry_date=day,
                         description=body.description, project_id=body.project_id)
    session.add(entry)
    await session.flush()
    for p in body.photos:
        path = p.get("storage_path", "")
        if not path.startswith(f"{org_id}/"):
            raise APIError(422, "BAD_PATH", "Photo path not scoped to org")
        head = await storage.object_head(path)
        if head is None:
            raise APIError(422, "UPLOAD_MISSING", "Uploaded object not found in storage")
        if not storage.check_magic_bytes(head, p.get("mime", "")):
            raise APIError(422, "BAD_FILE_TYPE", "File content is not a valid image")
        session.add(JournalPhoto(entry_id=entry.id, org_id=org_id,
                                 storage_path=path, mime=p["mime"], byte_size=p["byte_size"]))
    att = await _upsert_attendance(session, org_id, uid, day, "documented")
    await audit(session, org_id=org_id, actor_id=member.user_id, action="journal.created",
                entity_type="journal_entry", entity_id=entry.id,
                metadata={"day": str(day), "photos": len(body.photos)})
    await session.commit()
    return {"data": entry, "attendance": {"status": att.status, "duty_type": att.duty_type}}


@router.get("/orgs/{org_id}/journal")
async def feed(org_id: uuid.UUID, session: Session, day: date | None = None, member_id: uuid.UUID | None = None, project_id: uuid.UUID | None = None, page: int = 1, pageSize: int = 20, member: Membership = Depends(authorize())):
    page, page_size = page_params(page, pageSize)
    q = select(JournalEntry).where(JournalEntry.org_id == org_id)
    if day:
        q = q.where(JournalEntry.entry_date == day)
    if member_id:
        q = q.where(JournalEntry.member_id == member_id)
    if project_id:
        q = q.where(JournalEntry.project_id == project_id)
    total = (await session.execute(
        select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await session.execute(
        q.order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
         .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    photos = (await session.execute(
        select(JournalPhoto).where(JournalPhoto.entry_id.in_([e.id for e in rows])))).scalars().all() if rows else []
    pmap: dict[uuid.UUID, list[JournalPhoto]] = {}
    for p in photos:
        pmap.setdefault(p.entry_id, []).append(p)
    return envelope(
        [{**e.model_dump(), "photos": [p.model_dump() for p in pmap.get(e.id, [])]} for e in rows],
        page, page_size, total)


class EntryPatch(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=4000)
    project_id: uuid.UUID | None = None


def _editable(entry: JournalEntry, member: Membership) -> bool:
    """Author on their own same-day entry, or an owner anytime."""
    return (str(entry.member_id) == member.user_id and entry.entry_date == org_today()) \
        or member.role == "owner"


@router.patch("/orgs/{org_id}/journal/{entry_id}")
async def patch_entry(org_id: uuid.UUID, entry_id: uuid.UUID, body: EntryPatch, session: Session, member: Membership = Depends(authorize())):
    e = await session.get(JournalEntry, entry_id)
    if e is None or e.org_id != org_id:
        raise not_found("entry")
    is_own = str(e.member_id) == member.user_id
    same_day = e.entry_date == org_today()
    if not _editable(e, member):
        raise APIError(403, "FORBIDDEN", "Only the author same-day, or an owner, can edit entries")
    if body.description is not None:
        e.description = body.description
    # project_id is tri-state: absent → leave, null → clear, uuid → set+validate
    if "project_id" in body.model_fields_set:
        if body.project_id is None:
            e.project_id = None
        else:
            proj = await session.get(Project, body.project_id)
            if proj is None or proj.org_id != org_id:
                raise not_found("project")
            e.project_id = body.project_id
    e.updated_at = datetime.now(timezone.utc)
    if not (is_own and same_day):
        await audit(session, org_id=org_id, actor_id=member.user_id, action="journal.edited_post_day",
                    entity_type="journal_entry", entity_id=e.id)
    await session.commit()
    return {"data": e}


@router.delete("/orgs/{org_id}/journal/{entry_id}")
async def delete_entry(org_id: uuid.UUID, entry_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    e = await session.get(JournalEntry, entry_id)
    if e is None or e.org_id != org_id:
        raise not_found("entry")
    if not _editable(e, member):
        raise APIError(403, "FORBIDDEN", "Only the author same-day, or an owner, can delete entries")
    photos = (await session.execute(
        select(JournalPhoto).where(JournalPhoto.entry_id == e.id))).scalars().all()
    for p in photos:
        await session.delete(p)
    await session.delete(e)
    # recompute attendance — deleting the day's last entry un-documents it
    remaining = (await session.execute(select(JournalEntry).where(
        JournalEntry.org_id == org_id, JournalEntry.member_id == e.member_id,
        JournalEntry.entry_date == e.entry_date))).scalars().all()
    if not remaining:
        att = (await session.execute(select(AttendanceDay).where(
            AttendanceDay.org_id == org_id, AttendanceDay.member_id == e.member_id,
            AttendanceDay.day == e.entry_date))).scalars().first()
        if att is not None and att.status == "documented":
            await session.delete(att)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="journal.deleted",
                entity_type="journal_entry", entity_id=entry_id,
                metadata={"day": str(e.entry_date), "photos": len(photos)})
    await session.commit()
    # storage cleanup is best-effort — a stuck object never blocks the delete
    for p in photos:
        try:
            await storage.delete_object(p.storage_path)
        except Exception:
            pass
    return {"data": {"deleted": True, "id": str(entry_id)}}


@router.get("/orgs/{org_id}/photos/{photo_id}/url")
async def photo_url(org_id: uuid.UUID, photo_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    p = await session.get(JournalPhoto, photo_id)
    if p is None or p.org_id != org_id:
        raise not_found("photo")
    return {"url": await storage.signed_download_url(p.storage_path),
            "expires_in": 900}


# ── Attendance ───────────────────────────────────────────────────────────
class NoTasks(BaseModel):
    day: date | None = None


@router.post("/orgs/{org_id}/attendance/no-tasks", status_code=201)
async def declare_no_tasks(org_id: uuid.UUID, body: NoTasks, session: Session, member: Membership = Depends(authorize("member"))):
    day = body.day or org_today()
    if day > org_today():
        raise APIError(422, "FUTURE_DAY", "Cannot declare future days")
    att = await _upsert_attendance(session, org_id, uuid.UUID(member.user_id),
                                   day, "declared_no_tasks")
    await audit(session, org_id=org_id, actor_id=member.user_id, action="attendance.no_tasks",
                entity_type="attendance_day", entity_id=att.id, metadata={"day": str(day)})
    await session.commit()
    return {"data": att}


@router.delete("/orgs/{org_id}/attendance/{day}")
async def retract_no_tasks(org_id: uuid.UUID, day: date, session: Session,
                           member_id: uuid.UUID | None = None,
                           member: Membership = Depends(authorize())):
    """Retract a declared_no_tasks row — own row same-day, or owner for any
    member via ?member_id=. Documented days must delete the journal entry
    instead (that's where the proof lives)."""
    target = member_id or uuid.UUID(member.user_id)
    is_own = str(target) == member.user_id
    if not (is_own and day == org_today()) and member.role != "owner":
        raise APIError(403, "FORBIDDEN", "Only your own same-day declaration, or an owner, can be retracted")
    att = (await session.execute(select(AttendanceDay).where(
        AttendanceDay.org_id == org_id, AttendanceDay.member_id == target,
        AttendanceDay.day == day))).scalars().first()
    if att is None:
        raise not_found("attendance day")
    if att.status != "declared_no_tasks":
        raise APIError(409, "DOCUMENTED_DAY",
                       "That day is documented — delete the journal entry instead")
    await session.delete(att)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="attendance.retracted",
                entity_type="attendance_day", entity_id=att.id,
                metadata={"day": str(day), "member_id": str(target)})
    await session.commit()
    return {"data": {"deleted": True}}


@router.get("/orgs/{org_id}/attendance")
async def attendance(org_id: uuid.UUID, session: Session, day: date | None = None, from_: date | None = Query(None, alias="from"), to: date | None = None, member_id: uuid.UUID | None = None, member: Membership = Depends(authorize())):
    q = select(AttendanceDay).where(AttendanceDay.org_id == org_id)
    if day:
        q = q.where(AttendanceDay.day == day)
    if from_:
        q = q.where(AttendanceDay.day >= from_)
    if to:
        q = q.where(AttendanceDay.day <= to)
    if member_id:
        q = q.where(AttendanceDay.member_id == member_id)
    rows = (await session.execute(q.order_by(AttendanceDay.day.desc()).limit(500))).scalars().all()

    # unaccounted = scheduled duty member with no row that day (requires day param)
    unaccounted: list[str] = []
    if day:
        sy = (await session.execute(select(SchoolYear).where(
            SchoolYear.org_id == org_id, SchoolYear.is_current == True))).scalars().first()  # noqa: E712
        if sy:
            roster = (await session.execute(select(DutySchedule.member_id).where(
                DutySchedule.org_id == org_id, DutySchedule.school_year_id == sy.id,
                DutySchedule.weekday == day.weekday()))).scalars().all()
            filed = {r.member_id for r in rows}
            unaccounted = [str(m) for m in roster if m not in filed]

    return {"data": rows, "unaccounted_member_ids": unaccounted}


@router.get("/orgs/{org_id}/attendance/summary")
async def attendance_summary(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    sy = (await session.execute(select(SchoolYear).where(
        SchoolYear.org_id == org_id, SchoolYear.is_current == True))).scalars().first()  # noqa: E712
    if sy is None:
        return {"data": []}
    days = (await session.execute(select(AttendanceDay).where(
        AttendanceDay.org_id == org_id))).scalars().all()

    roster_rows = (await session.execute(select(DutySchedule).where(
        DutySchedule.org_id == org_id, DutySchedule.school_year_id == sy.id))).scalars().all()
    scheduled_weekdays: dict[uuid.UUID, set[int]] = {}
    for r in roster_rows:
        scheduled_weekdays.setdefault(r.member_id, set()).add(r.weekday)

    names = {str(m.user_id): p.display_name for m, p in (
        await session.execute(
            select(OrgMember, Profile)
            .join(Profile, Profile.id == OrgMember.user_id)
            .where(OrgMember.org_id == org_id, OrgMember.status == "active"))).all()}

    # compliance = filed days on scheduled weekdays / scheduled duty days elapsed
    today = org_today()
    start = sy.starts_on or (days[0].day if days else today)
    summary = []
    for uid, weekdays in scheduled_weekdays.items():
        elapsed = sum(
            1 for d in _days_between(start, today) if d.weekday() in weekdays
        )
        filed = sum(1 for d in days if d.member_id == uid and d.duty_type == "scheduled")
        extra = sum(1 for d in days if d.member_id == uid and d.duty_type == "extra")
        summary.append({
            "member_id": str(uid),
            "display_name": names.get(str(uid)),
            "scheduled_days_elapsed": elapsed,
            "filed": filed,
            "extra": extra,
            "compliance": round(filed / elapsed * 100, 1) if elapsed else None,
        })
    return {"data": summary, "school_year": sy.label}


def _days_between(a: date, b: date):
    from datetime import timedelta
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)
