import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import select

from ..deps import Membership, Session, authorize, require_user_in_org
from ..errors import APIError, not_found
from ..models import (ChecklistTemplate, ChecklistTemplateItem, Project,
                      ProjectChecklistItem)
from ..pagination import envelope, page_params
from ..services import instantiate
from ..services.audit import audit

router = APIRouter(tags=["projects"])


class ProjectIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    details: str | None = None
    event_type: str | None = None
    target_date: date | None = None
    owner_id: uuid.UUID | None = None
    status: str | None = Field(default=None, pattern="^(draft|active|done|archived)$")
    needs_paper_processing: bool = False
    needs_logistics: bool = False
    flags: dict[str, bool] = {}  # e.g. {"has_merch": true} for conditional steps/items


@router.get("/orgs/{org_id}/projects")
async def list_projects(org_id: uuid.UUID, session: Session, status: str | None = None, page: int = 1, pageSize: int = 20, member: Membership = Depends(authorize())):
    page, page_size = page_params(page, pageSize)
    q = select(Project).where(Project.org_id == org_id)
    if status:
        q = q.where(Project.status == status)
    rows = (await session.execute(
        q.order_by(Project.target_date.asc().nulls_last(), Project.created_at.desc())
         .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return envelope(rows, page, page_size, len(rows))


@router.post("/orgs/{org_id}/projects", status_code=201)
async def create_project(org_id: uuid.UUID, body: ProjectIn, session: Session, member: Membership = Depends(authorize("adviser"))):
    if body.owner_id:
        await require_user_in_org(session, org_id, str(body.owner_id))
    p = Project(org_id=org_id, owner_id=body.owner_id or uuid.UUID(member.user_id),
                **body.model_dump(exclude={"owner_id", "flags"}))
    session.add(p)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="project.created",
                entity_type="project", entity_id=p.id, metadata={"title": p.title})
    await session.commit()
    return {"data": p}


@router.get("/orgs/{org_id}/projects/{project_id}")
async def get_project(org_id: uuid.UUID, project_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    p = await session.get(Project, project_id)
    if p is None or p.org_id != org_id:
        raise not_found("project")
    items = (await session.execute(select(ProjectChecklistItem).where(
        ProjectChecklistItem.project_id == project_id).order_by(ProjectChecklistItem.ord))).scalars().all()
    return {"data": p, "checklist": items}


@router.patch("/orgs/{org_id}/projects/{project_id}")
async def patch_project(org_id: uuid.UUID, project_id: uuid.UUID, body: ProjectIn, session: Session, member: Membership = Depends(authorize("adviser"))):
    p = await session.get(Project, project_id)
    if p is None or p.org_id != org_id:
        raise not_found("project")
    for k, v in body.model_dump(exclude={"flags"}, exclude_none=True).items():
        setattr(p, k, v)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="project.updated",
                entity_type="project", entity_id=p.id)
    await session.commit()
    return {"data": p}


# ── Checklist templates ─────────────────────────────────────────────────
class TemplateItemIn(BaseModel):
    ord: int
    label: str = Field(min_length=1, max_length=300)
    hint: str | None = None
    required: bool = True
    rule_json: dict | None = None


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    track: str = Field(pattern="^(paper|logistics|both)$")
    event_type: str | None = None
    items: list[TemplateItemIn] = []


@router.get("/orgs/{org_id}/checklist-templates")
async def list_templates(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    templates = (await session.execute(select(ChecklistTemplate).where(
        ChecklistTemplate.org_id == org_id))).scalars().all()
    items = (await session.execute(
        select(ChecklistTemplateItem)
        .where(ChecklistTemplateItem.template_id.in_([t.id for t in templates]))
        .order_by(ChecklistTemplateItem.ord))).scalars().all() if templates else []
    imap: dict[uuid.UUID, list] = {}
    for it in items:
        imap.setdefault(it.template_id, []).append(it)
    return {"data": [{**t.model_dump(), "items": [i.model_dump() for i in imap.get(t.id, [])]}
                     for t in templates]}


@router.post("/orgs/{org_id}/checklist-templates", status_code=201)
async def create_template(org_id: uuid.UUID, body: TemplateIn, session: Session, member: Membership = Depends(authorize("owner"))):
    t = ChecklistTemplate(org_id=org_id, name=body.name, track=body.track,
                          event_type=body.event_type, created_by=uuid.UUID(member.user_id))
    session.add(t)
    await session.flush()
    for it in body.items:
        session.add(ChecklistTemplateItem(template_id=t.id, **it.model_dump()))
    await audit(session, org_id=org_id, actor_id=member.user_id, action="template.created",
                entity_type="checklist_template", entity_id=t.id, metadata={"name": t.name})
    await session.commit()
    return {"data": t}


# ── Instantiation + checkoff ────────────────────────────────────────────
class InstantiateBody(BaseModel):
    template_ids: list[uuid.UUID] | None = None  # None → auto-match by event_type+track


@router.post("/orgs/{org_id}/projects/{project_id}/instantiate", status_code=201)
async def instantiate_checklists(org_id: uuid.UUID, project_id: uuid.UUID, body: InstantiateBody, session: Session, member: Membership = Depends(authorize("adviser"))):
    p = await session.get(Project, project_id)
    if p is None or p.org_id != org_id:
        raise not_found("project")

    tq = select(ChecklistTemplate).where(ChecklistTemplate.org_id == org_id)
    if body.template_ids:
        tq = tq.where(ChecklistTemplate.id.in_(body.template_ids))
    else:
        wanted_tracks = []
        if p.needs_paper_processing:
            wanted_tracks += ["paper", "both"]
        if p.needs_logistics:
            wanted_tracks += ["logistics", "both"]
        tq = tq.where(ChecklistTemplate.track.in_(wanted_tracks)).where(
            (ChecklistTemplate.event_type == None) | (ChecklistTemplate.event_type == p.event_type))  # noqa: E711
    templates = (await session.execute(tq)).scalars().all()

    created = 0
    for t in templates:
        raw_items = (await session.execute(select(ChecklistTemplateItem).where(
            ChecklistTemplateItem.template_id == t.id).order_by(ChecklistTemplateItem.ord))).scalars().all()
        for inst in instantiate.instantiate_checklist(
                [i.model_dump() for i in raw_items],
                event_type=p.event_type, target_date=p.target_date):
            session.add(ProjectChecklistItem(
                org_id=org_id, project_id=p.id, template_id=t.id,
                ord=inst["ord"], label=inst["label"], hint=inst.get("hint"),
                required=inst.get("required", True), due_date=inst.get("due_date")))
            created += 1
    await audit(session, org_id=org_id, actor_id=member.user_id, action="checklist.instantiated",
                entity_type="project", entity_id=p.id,
                metadata={"templates": [str(t.id) for t in templates], "items": created})
    await session.commit()
    return {"instantiated_items": created, "templates_used": len(templates)}


class CheckBody(BaseModel):
    done: bool


@router.patch("/orgs/{org_id}/checklist-items/{item_id}")
async def check_item(org_id: uuid.UUID, item_id: uuid.UUID, body: CheckBody, session: Session, member: Membership = Depends(authorize("officer"))):
    it = await session.get(ProjectChecklistItem, item_id)
    if it is None or it.org_id != org_id:
        raise not_found("checklist item")
    it.done = body.done
    it.done_by = uuid.UUID(member.user_id) if body.done else None
    it.done_at = datetime.now(timezone.utc) if body.done else None
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="checklist_item.checked" if body.done else "checklist_item.unchecked",
                entity_type="project_checklist_item", entity_id=it.id)
    await session.commit()
    return {"data": it}
