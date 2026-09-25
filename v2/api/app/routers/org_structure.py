import uuid
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import delete, select

from ..deps import Membership, Session, authorize, require_user_in_org
from ..errors import APIError, not_found
from ..models import DutySchedule, OrgContact, Position, SchoolYear
from ..services.audit import audit

router = APIRouter(tags=["org-structure"])


async def _current_year(session, org_id: uuid.UUID) -> SchoolYear:
    sy = (await session.execute(
        select(SchoolYear).where(SchoolYear.org_id == org_id, SchoolYear.is_current == True)  # noqa: E712
    )).scalars().first()
    if sy is None:
        raise APIError(422, "NO_SCHOOL_YEAR", "Org has no current school year")
    return sy


# ── School years ─────────────────────────────────────────────────────────
@router.get("/orgs/{org_id}/school-years")
async def list_years(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    rows = (await session.execute(
        select(SchoolYear).where(SchoolYear.org_id == org_id).order_by(SchoolYear.label))).scalars().all()
    return {"data": rows}


class YearCreate(BaseModel):
    label: str = Field(min_length=4, max_length=40)
    set_current: bool = True
    starts_on: date | None = None
    ends_on: date | None = None


@router.post("/orgs/{org_id}/school-years", status_code=201)
async def create_year(org_id: uuid.UUID, body: YearCreate, session: Session, member: Membership = Depends(authorize("owner"))):
    if body.set_current:
        for sy in (await session.execute(
                select(SchoolYear).where(SchoolYear.org_id == org_id))).scalars().all():
            sy.is_current = False
    sy = SchoolYear(org_id=org_id, label=body.label, is_current=body.set_current,
                    starts_on=body.starts_on, ends_on=body.ends_on)
    session.add(sy)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="school_year.created",
                entity_type="school_year", entity_id=sy.id, metadata={"label": body.label})
    await session.commit()
    return {"data": sy}


# ── Positions / org chart ────────────────────────────────────────────────
class PositionIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    rank: int = 0
    holder: uuid.UUID | None = None
    reports_to: uuid.UUID | None = None


@router.get("/orgs/{org_id}/positions")
async def list_positions(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    sy = await _current_year(session, org_id)
    rows = (await session.execute(
        select(Position).where(Position.org_id == org_id, Position.school_year_id == sy.id)
        .order_by(Position.rank, Position.title))).scalars().all()
    return {"data": rows, "school_year": sy.label}


@router.post("/orgs/{org_id}/positions", status_code=201)
async def create_position(org_id: uuid.UUID, body: PositionIn, session: Session, member: Membership = Depends(authorize("owner"))):
    sy = await _current_year(session, org_id)
    if body.holder:
        await require_user_in_org(session, org_id, str(body.holder))
    pos = Position(org_id=org_id, school_year_id=sy.id, **body.model_dump())
    session.add(pos)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="position.created",
                entity_type="position", entity_id=pos.id, metadata={"title": body.title})
    await session.commit()
    return {"data": pos}


@router.patch("/orgs/{org_id}/positions/{position_id}")
async def patch_position(org_id: uuid.UUID, position_id: uuid.UUID, body: PositionIn, session: Session, member: Membership = Depends(authorize("owner"))):
    pos = await session.get(Position, position_id)
    if pos is None or pos.org_id != org_id:
        raise not_found("position")
    if body.holder:
        await require_user_in_org(session, org_id, str(body.holder))
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(pos, k, v)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="position.updated",
                entity_type="position", entity_id=pos.id, metadata=body.model_dump(exclude_none=True))
    await session.commit()
    return {"data": pos}


@router.get("/orgs/{org_id}/org-chart")
async def org_chart(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    sy = await _current_year(session, org_id)
    rows = (await session.execute(
        select(Position).where(Position.org_id == org_id, Position.school_year_id == sy.id)
        .order_by(Position.rank))).scalars().all()

    def node(p: Position) -> dict:
        return {
            "id": str(p.id), "title": p.title, "holder": str(p.holder) if p.holder else None,
            "children": [node(c) for c in rows if c.reports_to == p.id],
        }

    return {"data": [node(p) for p in rows if p.reports_to is None], "school_year": sy.label}


# ── Duty schedule ────────────────────────────────────────────────────────
@router.get("/orgs/{org_id}/duty-schedule")
async def get_duty(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    sy = await _current_year(session, org_id)
    rows = (await session.execute(
        select(DutySchedule).where(DutySchedule.org_id == org_id,
                                   DutySchedule.school_year_id == sy.id))).scalars().all()
    schedule: dict[int, list[str]] = {d: [] for d in range(7)}
    for r in rows:
        schedule[r.weekday].append(str(r.member_id))
    return {"data": schedule, "school_year": sy.label}


class DutyPut(BaseModel):
    # weekday (0=Mon..6=Sun) → member ids
    schedule: dict[int, list[uuid.UUID]]


@router.put("/orgs/{org_id}/duty-schedule")
async def put_duty(org_id: uuid.UUID, body: DutyPut, session: Session, member: Membership = Depends(authorize("owner"))):
    sy = await _current_year(session, org_id)
    for weekday, member_ids in body.schedule.items():
        if not 0 <= int(weekday) <= 6:
            raise APIError(422, "BAD_WEEKDAY", "weekday must be 0–6 (Mon–Sun)")
        for mid in member_ids:
            await require_user_in_org(session, org_id, str(mid))
    await session.execute(delete(DutySchedule).where(
        DutySchedule.org_id == org_id, DutySchedule.school_year_id == sy.id))
    for weekday, member_ids in body.schedule.items():
        for mid in member_ids:
            session.add(DutySchedule(org_id=org_id, school_year_id=sy.id,
                                     weekday=int(weekday), member_id=mid))
    await audit(session, org_id=org_id, actor_id=member.user_id, action="duty_schedule.updated",
                entity_type="duty_schedule", metadata={"schedule": {str(k): [str(i) for i in v] for k, v in body.schedule.items()}})
    await session.commit()
    return {"ok": True}


# ── Contacts directory ───────────────────────────────────────────────────
class ContactIn(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    value: str = Field(min_length=1, max_length=500)
    category: str | None = None
    ord: int = 0


@router.get("/orgs/{org_id}/contacts")
async def list_contacts(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    rows = (await session.execute(
        select(OrgContact).where(OrgContact.org_id == org_id).order_by(OrgContact.ord))).scalars().all()
    return {"data": rows}


@router.post("/orgs/{org_id}/contacts", status_code=201)
async def create_contact(org_id: uuid.UUID, body: ContactIn, session: Session, member: Membership = Depends(authorize("owner"))):
    c = OrgContact(org_id=org_id, **body.model_dump())
    session.add(c)
    await session.commit()
    return {"data": c}
