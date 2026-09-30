import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import delete, select

from ..deps import Membership, Session, authorize, require_user_in_org
from ..errors import APIError, not_found
from ..models import (ChecklistTemplate, ChecklistTemplateItem, Project,
                      ProjectChecklistItem)
from ..pagination import envelope, page_params
from ..services import instantiate
from ..services.audit import audit
from ..services.idempotent import add_deduped, deduped_response
from ..services.notify import fan_out_assignment

router = APIRouter(tags=["projects"])


class ItemSeed(BaseModel):
    label: str = Field(min_length=1, max_length=300)
    hint: str | None = None
    required: bool = True
    due_date: date | None = None


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
    # provided → write these items verbatim at create (ord = array index);
    # absent → checklist stays empty until instantiate runs
    checklist_items: list[ItemSeed] | None = Field(default=None, max_length=100)
    client_request_id: str | None = Field(default=None, max_length=64)


@router.get("/orgs/{org_id}/projects")
async def list_projects(org_id: uuid.UUID, session: Session, status: str | None = None, page: int = 1, pageSize: int = 20, member: Membership = Depends(authorize())):
    page, page_size = page_params(page, pageSize)
    q = select(Project).where(Project.org_id == org_id)
    if status:
        q = q.where(Project.status == status)
    total = (await session.execute(
        select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await session.execute(
        q.order_by(Project.target_date.asc().nulls_last(), Project.created_at.desc())
         .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return envelope(rows, page, page_size, total)


@router.post("/orgs/{org_id}/projects", status_code=201)
async def create_project(org_id: uuid.UUID, body: ProjectIn, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize("adviser"))):
    if body.owner_id:
        await require_user_in_org(session, org_id, str(body.owner_id))
    p = Project(org_id=org_id, owner_id=body.owner_id or uuid.UUID(member.user_id),
                **body.model_dump(exclude={"owner_id", "checklist_items"}))
    p, deduped = await add_deduped(
        session, p, Project, org_id=org_id,
        client_request_id=body.client_request_id)
    if deduped:
        return deduped_response(p)
    if body.checklist_items is not None:
        for idx, it in enumerate(body.checklist_items):
            session.add(ProjectChecklistItem(
                org_id=org_id, project_id=p.id, ord=idx,
                label=it.label, hint=it.hint, required=it.required,
                due_date=it.due_date))
    await audit(session, org_id=org_id, actor_id=member.user_id, action="project.created",
                entity_type="project", entity_id=p.id, metadata={"title": p.title})
    # inbox row must commit with the assign — fan-out runs before commit
    await fan_out_assignment(bg=bg, session=session, org_id=org_id,
                             actor_id=member.user_id, kind="project",
                             title=p.title, assignee_id=p.owner_id,
                             entity_type="project", entity_id=p.id)
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


class ProjectPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    details: str | None = None
    event_type: str | None = None
    target_date: date | None = None
    owner_id: uuid.UUID | None = None
    status: str | None = Field(default=None, pattern="^(draft|active|done|archived)$")
    needs_paper_processing: bool | None = None
    needs_logistics: bool | None = None
    flags: dict[str, bool] | None = None  # None → untouched (ProjectIn's {} would wipe)


@router.patch("/orgs/{org_id}/projects/{project_id}")
async def patch_project(org_id: uuid.UUID, project_id: uuid.UUID, body: ProjectPatch, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize())):
    p = await session.get(Project, project_id)
    if p is None or p.org_id != org_id:
        raise not_found("project")
    if not member.at_least("adviser"):
        # the project's lead may move its status — and nothing else
        if str(p.owner_id) != member.user_id or set(body.model_fields_set) != {"status"}:
            raise APIError(403, "FORBIDDEN",
                           "Only adviser+ can edit projects — the lead can move status")
        if body.status is None:
            raise APIError(422, "NOTHING_TO_DO", "No status supplied")
    if body.owner_id and body.owner_id != p.owner_id:
        await require_user_in_org(session, org_id, str(body.owner_id))
    changed_lead = bool(body.owner_id) and body.owner_id != p.owner_id
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="project.updated",
                entity_type="project", entity_id=p.id)
    if changed_lead:
        await audit(session, org_id=org_id, actor_id=member.user_id, action="project.assigned",
                    entity_type="project", entity_id=p.id, metadata={"assignee_id": str(body.owner_id)})
    if changed_lead:
        await fan_out_assignment(bg=bg, session=session, org_id=org_id,
                                 actor_id=member.user_id, kind="project",
                                 title=p.title, assignee_id=body.owner_id,
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


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    track: str | None = Field(default=None, pattern="^(paper|logistics|both)$")
    event_type: str | None = None          # explicit null clears the scope
    items: list[TemplateItemIn] | None = None  # provided → wholesale replace


@router.patch("/orgs/{org_id}/checklist-templates/{template_id}")
async def patch_template(org_id: uuid.UUID, template_id: uuid.UUID, body: TemplatePatch, session: Session, member: Membership = Depends(authorize("owner"))):
    t = await session.get(ChecklistTemplate, template_id)
    if t is None or t.org_id != org_id:
        raise not_found("checklist template")
    if body.name is not None:
        t.name = body.name
    if body.track is not None:
        t.track = body.track
    if "event_type" in body.model_fields_set:
        t.event_type = body.event_type
    if body.items is not None:
        await session.execute(delete(ChecklistTemplateItem).where(
            ChecklistTemplateItem.template_id == t.id))
        for it in body.items:
            session.add(ChecklistTemplateItem(template_id=t.id, **it.model_dump()))
    await audit(session, org_id=org_id, actor_id=member.user_id, action="template.updated",
                entity_type="checklist_template", entity_id=t.id, metadata={"name": t.name})
    await session.commit()
    return {"data": t}


@router.delete("/orgs/{org_id}/checklist-templates/{template_id}")
async def delete_template(org_id: uuid.UUID, template_id: uuid.UUID, session: Session, member: Membership = Depends(authorize("owner"))):
    t = await session.get(ChecklistTemplate, template_id)
    if t is None or t.org_id != org_id:
        raise not_found("checklist template")
    # Generated checklists are snapshots; template_id clears via SET NULL FK.
    instances = (await session.execute(select(func.count()).where(
        ProjectChecklistItem.template_id == t.id))).scalar_one()
    await audit(session, org_id=org_id, actor_id=member.user_id, action="template.deleted",
                entity_type="checklist_template", entity_id=t.id,
                metadata={"name": t.name, "instances": instances})
    await session.delete(t)
    await session.commit()
    return {"ok": True}


# ── Instantiation + checkoff ────────────────────────────────────────────
class InstantiateBody(BaseModel):
    template_ids: list[uuid.UUID] | None = None  # None → auto-match by event_type+track
    append: bool = False                          # skip the already-populated guard


@router.post("/orgs/{org_id}/projects/{project_id}/instantiate", status_code=201)
async def instantiate_checklists(org_id: uuid.UUID, project_id: uuid.UUID, body: InstantiateBody, session: Session, member: Membership = Depends(authorize("adviser"))):
    p = await session.get(Project, project_id)
    if p is None or p.org_id != org_id:
        raise not_found("project")

    existing = (await session.execute(select(func.count()).where(
        ProjectChecklistItem.project_id == project_id))).scalar_one()
    if existing and not body.append:
        raise APIError(409, "ALREADY_INSTANTIATED",
                       f"Checklist already has {existing} item(s) — pass append=true to add duplicates on purpose")

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
                event_type=p.event_type, flags=p.flags or {},
                target_date=p.target_date):
            session.add(ProjectChecklistItem(
                org_id=org_id, project_id=p.id, template_id=t.id,
                ord=inst["ord"], label=inst["label"], hint=inst.get("hint"),
                required=inst.get("required", True), due_date=inst.get("due_date")))
            created += 1
    if created > 0:
        reason = "ok"
    elif body.template_ids:
        reason = "templates_not_found" if not templates else "items_filtered"
    else:
        all_templates = (await session.execute(select(ChecklistTemplate).where(
            ChecklistTemplate.org_id == org_id))).scalars().all()
        reason = instantiate.diagnose_checklist(
            all_templates, needs_paper=p.needs_paper_processing,
            needs_logistics=p.needs_logistics, event_type=p.event_type)

    await audit(session, org_id=org_id, actor_id=member.user_id, action="checklist.instantiated",
                entity_type="project", entity_id=p.id,
                metadata={"templates": [str(t.id) for t in templates], "items": created})
    await session.commit()
    return {"instantiated_items": created, "templates_used": len(templates), "reason": reason}


@router.get("/orgs/{org_id}/checklist-items")
async def list_checklist_items(org_id: uuid.UUID, session: Session,
                               assignee_id: uuid.UUID | None = None,
                               done: bool | None = None,
                               member: Membership = Depends(authorize())):
    """Flat list across projects — powers the 'what needs you' surfaces."""
    q = (select(ProjectChecklistItem, Project.title)
         .join(Project, Project.id == ProjectChecklistItem.project_id)
         .where(ProjectChecklistItem.org_id == org_id))
    if assignee_id:
        q = q.where(ProjectChecklistItem.assignee_id == assignee_id)
    if done is not None:
        q = q.where(ProjectChecklistItem.done == done)
    rows = (await session.execute(
        q.order_by(ProjectChecklistItem.due_date.asc().nulls_last(),
                   ProjectChecklistItem.created_at))).all()
    return {"data": [{**item.model_dump(), "project_title": proj_title}
                     for item, proj_title in rows]}


class ChecklistItemPatch(BaseModel):
    done: bool | None = None
    assignee_id: uuid.UUID | None = None  # send explicit null to unassign
    label: str | None = Field(default=None, min_length=1, max_length=300)
    hint: str | None = None            # tri-state: absent → leave, null → clear
    required: bool | None = None
    due_date: date | None = None       # tri-state: absent → leave, null → clear
    ord: int | None = None


STRUCTURAL_FIELDS = {"label", "hint", "required", "due_date", "ord"}


@router.patch("/orgs/{org_id}/checklist-items/{item_id}")
async def patch_item(org_id: uuid.UUID, item_id: uuid.UUID, body: ChecklistItemPatch, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize())):
    it = await session.get(ProjectChecklistItem, item_id)
    if it is None or it.org_id != org_id:
        raise not_found("checklist item")

    structural = set(body.model_fields_set) & STRUCTURAL_FIELDS
    if structural:
        # editing the item itself is adviser+ / project-lead territory
        p = await session.get(Project, it.project_id)
        if p is None or p.org_id != org_id:
            raise not_found("project")
        if not _structural_ok(p, member):
            raise APIError(403, "FORBIDDEN",
                           "Only adviser+ or the project lead can change checklist items")
        if "label" in body.model_fields_set:
            it.label = body.label
        if "hint" in body.model_fields_set:
            it.hint = body.hint
        if body.required is not None:
            it.required = body.required
        if "due_date" in body.model_fields_set:
            it.due_date = body.due_date
        if body.ord is not None:
            it.ord = body.ord
        await audit(session, org_id=org_id, actor_id=member.user_id,
                    action="checklist_item.edited",
                    entity_type="project_checklist_item", entity_id=it.id,
                    metadata={"fields": sorted(structural)})
    if not structural or ({"done", "assignee_id"} & set(body.model_fields_set)):
        if not member.at_least("officer"):
            raise APIError(403, "FORBIDDEN",
                           "Only officers can tick or assign checklist items")

    assigned = None
    if "assignee_id" in body.model_fields_set:
        target = body.assignee_id
        # officers may (un)assign themselves; assigning someone else needs adviser+
        self_change = (str(target) == member.user_id
                       or (target is None and str(it.assignee_id) == member.user_id))
        if not self_change and not member.at_least("adviser"):
            raise APIError(403, "FORBIDDEN", "Only adviser+ can assign items to other members")
        if target is not None:
            await require_user_in_org(session, org_id, str(target))
        if it.assignee_id != target:
            it.assignee_id = target
            assigned = target
            await audit(session, org_id=org_id, actor_id=member.user_id,
                        action="checklist_item.assigned" if target else "checklist_item.unassigned",
                        entity_type="project_checklist_item", entity_id=it.id,
                        metadata={"assignee_id": str(target) if target else None})

    if body.done is not None:
        it.done = body.done
        it.done_by = uuid.UUID(member.user_id) if body.done else None
        it.done_at = datetime.now(timezone.utc) if body.done else None
        await audit(session, org_id=org_id, actor_id=member.user_id,
                    action="checklist_item.checked" if body.done else "checklist_item.unchecked",
                    entity_type="project_checklist_item", entity_id=it.id)

    if assigned is not None:
        await fan_out_assignment(bg=bg, session=session, org_id=org_id,
                                 actor_id=member.user_id, kind="checklist_item",
                                 title=it.label, assignee_id=assigned,
                                 entity_type="project", entity_id=it.project_id)
    await session.commit()
    return {"data": it}


# ── Checklist item structure: add / edit fields / reorder / delete ──────
def _structural_ok(project: Project, member: Membership) -> bool:
    """Adviser+ or the project's own lead may shape the checklist."""
    return member.at_least("adviser") or str(project.owner_id) == member.user_id


async def _require_structural(session, org_id: uuid.UUID, project_id: uuid.UUID,
                              member: Membership) -> Project:
    p = await session.get(Project, project_id)
    if p is None or p.org_id != org_id:
        raise not_found("project")
    if not _structural_ok(p, member):
        raise APIError(403, "FORBIDDEN",
                       "Only adviser+ or the project lead can change checklist items")
    return p


@router.post("/orgs/{org_id}/projects/{project_id}/checklist-items", status_code=201)
async def add_checklist_item(org_id: uuid.UUID, project_id: uuid.UUID, body: ItemSeed,
                             session: Session, member: Membership = Depends(authorize())):
    p = await _require_structural(session, org_id, project_id, member)
    top = (await session.execute(select(func.max(ProjectChecklistItem.ord)).where(
        ProjectChecklistItem.project_id == p.id))).scalar_one() or -1
    it = ProjectChecklistItem(org_id=org_id, project_id=p.id, ord=top + 1,
                              label=body.label, hint=body.hint,
                              required=body.required, due_date=body.due_date)
    session.add(it)
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="checklist_item.added",
                entity_type="project_checklist_item", entity_id=it.id,
                metadata={"label": it.label})
    await session.commit()
    return {"data": it}


class ReorderIn(BaseModel):
    item_ids: list[uuid.UUID]


@router.post("/orgs/{org_id}/projects/{project_id}/checklist-items/reorder")
async def reorder_checklist_items(org_id: uuid.UUID, project_id: uuid.UUID, body: ReorderIn,
                                  session: Session, member: Membership = Depends(authorize())):
    p = await _require_structural(session, org_id, project_id, member)
    items = (await session.execute(select(ProjectChecklistItem).where(
        ProjectChecklistItem.project_id == p.id))).scalars().all()
    if {s.id for s in items} != set(body.item_ids):
        raise APIError(422, "ITEM_SET_MISMATCH",
                       "item_ids must be exactly this project's items")
    order = {iid: i for i, iid in enumerate(body.item_ids)}
    for it in items:
        it.ord = order[it.id]
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="checklist.reordered",
                entity_type="project", entity_id=p.id)
    await session.commit()
    return {"data": {"reordered": len(items)}}


@router.delete("/orgs/{org_id}/checklist-items/{item_id}")
async def delete_checklist_item(org_id: uuid.UUID, item_id: uuid.UUID,
                                session: Session, member: Membership = Depends(authorize())):
    it = await session.get(ProjectChecklistItem, item_id)
    if it is None or it.org_id != org_id:
        raise not_found("checklist item")
    await _require_structural(session, org_id, it.project_id, member)
    await session.delete(it)
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="checklist_item.deleted",
                entity_type="project_checklist_item", entity_id=it.id,
                metadata={"label": it.label, "done": it.done,
                          "assignee_id": str(it.assignee_id) if it.assignee_id else None})
    await session.commit()
    return {"ok": True}
