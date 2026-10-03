import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import aliased
from sqlmodel import delete, select

from ..deps import Membership, Session, authorize
from ..errors import APIError, not_found
from ..models import (Document, DocumentMovement, DocumentRevision,
                      DocumentSignatoryStep, Project, SignatoryChain,
                      SignatoryStep)
from ..pagination import envelope, org_today, page_params
from ..services import instantiate, storage
from ..services.audit import audit
from ..services.idempotent import add_deduped, deduped_response
from ..services.notify import (fan_out_desk, fan_out_doc_signed,
                               fan_out_sent_back)

router = APIRouter(tags=["documents"])


def _next_desk(steps, round_no: int):
    """The desk a paper currently sits at: lowest-ord pending step of the
    round. Chains are sequential — only that desk gets pinged."""
    pending = [s for s in steps if s.status == "pending" and s.round_no == round_no]
    return min(pending, key=lambda s: s.ord) if pending else None


# ── Signatory chain templates ───────────────────────────────────────────
class StepIn(BaseModel):
    ord: int
    label: str = Field(min_length=1, max_length=160)
    office: str | None = None
    condition_json: dict | None = None


class ChainIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    doc_type: str = Field(min_length=1, max_length=60)
    steps: list[StepIn] = []


@router.get("/orgs/{org_id}/signatory-chains")
async def list_chains(org_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    chains = (await session.execute(
        select(SignatoryChain).where(SignatoryChain.org_id == org_id))).scalars().all()
    steps = (await session.execute(
        select(SignatoryStep).where(SignatoryStep.chain_id.in_([c.id for c in chains]))
        .order_by(SignatoryStep.ord))).scalars().all() if chains else []
    smap: dict[uuid.UUID, list] = {}
    for s in steps:
        smap.setdefault(s.chain_id, []).append(s)
    return {"data": [{**c.model_dump(), "steps": [s.model_dump() for s in smap.get(c.id, [])]}
                     for c in chains]}


@router.post("/orgs/{org_id}/signatory-chains", status_code=201)
async def create_chain(org_id: uuid.UUID, body: ChainIn, session: Session, member: Membership = Depends(authorize("owner"))):
    c = SignatoryChain(org_id=org_id, name=body.name, doc_type=body.doc_type)
    session.add(c)
    await session.flush()
    for s in body.steps:
        session.add(SignatoryStep(chain_id=c.id, **s.model_dump()))
    await audit(session, org_id=org_id, actor_id=member.user_id, action="chain.created",
                entity_type="signatory_chain", entity_id=c.id, metadata={"name": c.name})
    await session.commit()
    return {"data": c}


class ChainPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    doc_type: str | None = Field(default=None, min_length=1, max_length=60)
    steps: list[StepIn] | None = None  # provided → wholesale replace


@router.patch("/orgs/{org_id}/signatory-chains/{chain_id}")
async def patch_chain(org_id: uuid.UUID, chain_id: uuid.UUID, body: ChainPatch, session: Session, member: Membership = Depends(authorize("owner"))):
    c = await session.get(SignatoryChain, chain_id)
    if c is None or c.org_id != org_id:
        raise not_found("signatory chain")
    if body.name is not None:
        c.name = body.name
    if body.doc_type is not None:
        c.doc_type = body.doc_type
    if body.steps is not None:
        await session.execute(delete(SignatoryStep).where(SignatoryStep.chain_id == c.id))
        for s in body.steps:
            session.add(SignatoryStep(chain_id=c.id, **s.model_dump()))
    await audit(session, org_id=org_id, actor_id=member.user_id, action="chain.updated",
                entity_type="signatory_chain", entity_id=c.id, metadata={"name": c.name})
    await session.commit()
    return {"data": c}


@router.delete("/orgs/{org_id}/signatory-chains/{chain_id}")
async def delete_chain(org_id: uuid.UUID, chain_id: uuid.UUID, session: Session, member: Membership = Depends(authorize("owner"))):
    c = await session.get(SignatoryChain, chain_id)
    if c is None or c.org_id != org_id:
        raise not_found("signatory chain")
    # Document steps are instantiated snapshots with no FK back — always safe.
    await audit(session, org_id=org_id, actor_id=member.user_id, action="chain.deleted",
                entity_type="signatory_chain", entity_id=c.id, metadata={"name": c.name})
    await session.delete(c)
    await session.commit()
    return {"ok": True}


# ── Documents + movements + step progression ────────────────────────────
class DocIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    doc_type: str = Field(min_length=1, max_length=60)
    project_id: uuid.UUID | None = None
    chain_id: uuid.UUID | None = None  # override; else auto-match by doc_type
    flags: dict[str, bool] = {}
    client_request_id: str | None = Field(default=None, max_length=64)


@router.get("/orgs/{org_id}/documents")
async def list_documents(org_id: uuid.UUID, session: Session, status: str | None = None,
                         held_by: str | None = None,
                         page: int = 1, pageSize: int = 20, member: Membership = Depends(authorize())):
    page, page_size = page_params(page, pageSize)
    q = select(Document).where(Document.org_id == org_id)
    if status:
        q = q.where(Document.status == status)
    if held_by == "me":
        # papers physically with me = my movement is the newest on the doc.
        # "Newest" = max(created_at), ties broken by id so equal timestamps
        # resolve deterministically — an anti-join, so no doc row duplicates.
        uid = uuid.UUID(member.user_id)
        newer = aliased(DocumentMovement)
        has_newer = (
            select(newer.id)
            .where(newer.document_id == DocumentMovement.document_id)
            .where(or_(newer.created_at > DocumentMovement.created_at,
                       and_(newer.created_at == DocumentMovement.created_at,
                            newer.id > DocumentMovement.id)))
            .exists()
        )
        latest_mine = (select(DocumentMovement.document_id)
                       .where(DocumentMovement.moved_by == uid, ~has_newer))
        q = q.where(Document.id.in_(latest_mine))
    total = (await session.execute(
        select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await session.execute(
        q.order_by(Document.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return envelope(rows, page, page_size, total)


@router.post("/orgs/{org_id}/documents", status_code=201)
async def create_document(org_id: uuid.UUID, body: DocIn, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize("officer"))):
    proj = None
    if body.project_id:
        proj = await session.get(Project, body.project_id)
        if proj is None or proj.org_id != org_id:
            raise not_found("project")
    event_type = proj.event_type if proj else None
    # explicit body flags win; otherwise inherit the linked project's flags
    flags = body.flags or (proj.flags if proj else None) or {}

    doc = Document(org_id=org_id, project_id=body.project_id, title=body.title,
                   doc_type=body.doc_type, flags=flags,
                   created_by=uuid.UUID(member.user_id),
                   client_request_id=body.client_request_id)
    doc, deduped = await add_deduped(
        session, doc, Document, org_id=org_id,
        client_request_id=body.client_request_id)
    if deduped:
        return deduped_response(doc)

    # instantiate signatory steps from matching chain
    chain_id = body.chain_id
    if chain_id is None:
        chain = (await session.execute(select(SignatoryChain).where(
            SignatoryChain.org_id == org_id, SignatoryChain.doc_type == body.doc_type)
            .order_by(SignatoryChain.name))).scalars().first()
        chain_id = chain.id if chain else None
    first_desk = None
    if chain_id:
        raw = (await session.execute(select(SignatoryStep).where(
            SignatoryStep.chain_id == chain_id).order_by(SignatoryStep.ord))).scalars().all()
        for s in instantiate.instantiate_chain(
                [x.model_dump() for x in raw], event_type=event_type, flags=flags):
            step = DocumentSignatoryStep(
                org_id=org_id, document_id=doc.id, ord=s["ord"], label=s["label"],
                office=s.get("office"))
            session.add(step)
            if first_desk is None or step.ord < first_desk.ord:
                first_desk = step
        doc.status = "routing"
    if first_desk is not None:
        await fan_out_desk(session, bg, org_id=org_id,
                           actor_id=member.user_id, doc=doc, step=first_desk)

    await audit(session, org_id=org_id, actor_id=member.user_id, action="document.created",
                entity_type="document", entity_id=doc.id,
                metadata={"doc_type": body.doc_type, "chain": str(chain_id) if chain_id else None})
    await session.commit()
    return {"data": doc}


@router.get("/orgs/{org_id}/documents/{doc_id}")
async def get_document(org_id: uuid.UUID, doc_id: uuid.UUID, session: Session, member: Membership = Depends(authorize())):
    doc = await session.get(Document, doc_id)
    if doc is None or doc.org_id != org_id:
        raise not_found("document")
    movements = (await session.execute(select(DocumentMovement).where(
        DocumentMovement.document_id == doc_id).order_by(DocumentMovement.created_at))).scalars().all()
    steps = (await session.execute(select(DocumentSignatoryStep).where(
        DocumentSignatoryStep.document_id == doc_id)
        .order_by(DocumentSignatoryStep.round_no, DocumentSignatoryStep.ord))).scalars().all()
    revisions = (await session.execute(select(DocumentRevision).where(
        DocumentRevision.document_id == doc_id).order_by(DocumentRevision.created_at))).scalars().all()
    return {"data": doc, "movements": movements, "signatory_steps": steps,
            "revisions": revisions,
            "current_round": max((s.round_no for s in steps), default=1),
            "current_location": movements[-1].location_text if movements else None}


class AttachChain(BaseModel):
    chain_id: uuid.UUID


@router.post("/orgs/{org_id}/documents/{doc_id}/attach-chain")
async def attach_chain(org_id: uuid.UUID, doc_id: uuid.UUID, body: AttachChain, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize("officer"))):
    """Route an unrouted document — escape hatch for docs created before a
    matching chain existed."""
    doc = await session.get(Document, doc_id)
    if doc is None or doc.org_id != org_id:
        raise not_found("document")
    chain = await session.get(SignatoryChain, body.chain_id)
    if chain is None or chain.org_id != org_id:
        raise not_found("signatory chain")
    existing = (await session.execute(select(DocumentSignatoryStep).where(
        DocumentSignatoryStep.document_id == doc_id))).scalars().first()
    if existing is not None:
        raise APIError(409, "CHAIN_EXISTS", "Document already has a signatory chain")

    event_type = None
    if doc.project_id:
        proj = await session.get(Project, doc.project_id)
        event_type = proj.event_type if proj else None
    raw = (await session.execute(select(SignatoryStep).where(
        SignatoryStep.chain_id == chain.id).order_by(SignatoryStep.ord))).scalars().all()
    first_desk = None
    for s in instantiate.instantiate_chain(
            [x.model_dump() for x in raw], event_type=event_type, flags=doc.flags or {}):
        step = DocumentSignatoryStep(
            org_id=org_id, document_id=doc.id, ord=s["ord"], label=s["label"],
            office=s.get("office"))
        session.add(step)
        if first_desk is None or step.ord < first_desk.ord:
            first_desk = step
    doc.status = "routing"
    if first_desk is not None:
        await fan_out_desk(session, bg, org_id=org_id,
                           actor_id=member.user_id, doc=doc, step=first_desk)

    await audit(session, org_id=org_id, actor_id=member.user_id, action="document.chain_attached",
                entity_type="document", entity_id=doc.id,
                metadata={"chain_id": str(chain.id), "chain": chain.name})
    await session.commit()
    return {"data": doc}


class MovementIn(BaseModel):
    location_text: str = Field(min_length=1, max_length=300)
    note: str | None = None
    photo_path: str | None = None
    step_id: uuid.UUID | None = None   # which process card this evidence pins to
    client_request_id: str | None = Field(default=None, max_length=64)


@router.post("/orgs/{org_id}/documents/{doc_id}/movements", status_code=201)
async def add_movement(org_id: uuid.UUID, doc_id: uuid.UUID, body: MovementIn, session: Session, member: Membership = Depends(authorize("officer"))):
    doc = await session.get(Document, doc_id)
    if doc is None or doc.org_id != org_id:
        raise not_found("document")
    if body.photo_path and not body.photo_path.startswith(f"{org_id}/"):
        raise APIError(422, "BAD_PATH", "Photo path not scoped to org")
    if body.step_id is not None:
        step = await session.get(DocumentSignatoryStep, body.step_id)
        if step is None or step.document_id != doc_id:
            raise APIError(422, "STEP_MISMATCH",
                           "step_id must be a signatory step of this document")
    mv = DocumentMovement(org_id=org_id, document_id=doc_id, moved_by=uuid.UUID(member.user_id),
                          **body.model_dump())
    mv, deduped = await add_deduped(
        session, mv, DocumentMovement, org_id=org_id,
        client_request_id=body.client_request_id)
    if deduped:
        return deduped_response(mv)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="document.moved",
                entity_type="document", entity_id=doc.id,
                metadata={"location": body.location_text})
    await session.commit()
    return {"data": mv}


@router.get("/orgs/{org_id}/documents/{doc_id}/movements/{movement_id}/photo")
async def movement_photo_url(org_id: uuid.UUID, doc_id: uuid.UUID, movement_id: uuid.UUID,
                             session: Session, member: Membership = Depends(authorize())):
    """Signed download URL for a movement's photo — the chain cards' evidence
    thumbnails hit this (movement rows store private storage paths only)."""
    mv = await _get_movement(org_id, doc_id, movement_id, session)
    if not mv.photo_path:
        raise not_found("movement photo")
    return {"url": await storage.signed_download_url(mv.photo_path),
            "expires_in": 900}


class MovementPatch(BaseModel):
    location_text: str | None = Field(default=None, min_length=1, max_length=300)
    note: str | None = None
    photo_path: str | None = None    # replace the photo (org-scoped, uploaded)
    clear_photo: bool | None = None  # remove the photo entirely


def _movement_org_day(mv: DocumentMovement) -> date:
    """The movement's day in org time — created_at is UTC, 'same day' is Manila."""
    from zoneinfo import ZoneInfo
    from ..config import get_settings
    ts = mv.created_at
    if ts.tzinfo is None:                       # sqlite tests store naive — treat as UTC
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(ZoneInfo(get_settings().org_timezone)).date()


def _movement_editable(mv: DocumentMovement, member: Membership) -> bool:
    """Mover on their own same-day entry, or an owner anytime."""
    return (str(mv.moved_by) == member.user_id
            and _movement_org_day(mv) == org_today()) or member.role == "owner"


async def _get_movement(org_id: uuid.UUID, doc_id: uuid.UUID, movement_id: uuid.UUID, session) -> DocumentMovement:
    mv = await session.get(DocumentMovement, movement_id)
    if mv is None or mv.org_id != org_id or mv.document_id != doc_id:
        raise not_found("movement")
    return mv


@router.patch("/orgs/{org_id}/documents/{doc_id}/movements/{movement_id}")
async def patch_movement(org_id: uuid.UUID, doc_id: uuid.UUID, movement_id: uuid.UUID,
                         body: MovementPatch, session: Session,
                         member: Membership = Depends(authorize("officer"))):
    mv = await _get_movement(org_id, doc_id, movement_id, session)
    if not _movement_editable(mv, member):
        raise APIError(403, "FORBIDDEN", "Only the mover same-day, or an owner, can edit a movement")
    if body.photo_path and body.clear_photo:
        raise APIError(422, "PHOTO_CONFLICT", "photo_path and clear_photo can't both be sent")
    if body.location_text is not None:
        mv.location_text = body.location_text
    # note is tri-state: absent → leave, null → clear, string → set
    if "note" in body.model_fields_set:
        mv.note = body.note
    old_photo = None
    if body.clear_photo or body.photo_path:
        if body.photo_path:
            if not body.photo_path.startswith(f"{org_id}/"):
                raise APIError(422, "BAD_PATH", "Photo path not scoped to org")
            if await storage.object_head(body.photo_path) is None:
                raise APIError(422, "UPLOAD_MISSING",
                               "Uploaded object not found in storage")
        old_photo, mv.photo_path = mv.photo_path, (None if body.clear_photo else body.photo_path)
    if not (str(mv.moved_by) == member.user_id and _movement_org_day(mv) == org_today()):
        await audit(session, org_id=org_id, actor_id=member.user_id, action="document.movement_edited",
                    entity_type="document", entity_id=doc_id, metadata={"movement_id": str(movement_id)})
    await session.commit()
    if old_photo:
        try:
            await storage.delete_object(old_photo)
        except Exception:
            pass
    return {"data": mv}


@router.delete("/orgs/{org_id}/documents/{doc_id}/movements/{movement_id}")
async def delete_movement(org_id: uuid.UUID, doc_id: uuid.UUID, movement_id: uuid.UUID,
                          session: Session, member: Membership = Depends(authorize("officer"))):
    mv = await _get_movement(org_id, doc_id, movement_id, session)
    if not _movement_editable(mv, member):
        raise APIError(403, "FORBIDDEN", "Only the mover same-day, or an owner, can delete a movement")
    photo = mv.photo_path
    await session.delete(mv)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="document.movement_deleted",
                entity_type="document", entity_id=doc_id,
                metadata={"movement_id": str(movement_id), "location": mv.location_text})
    await session.commit()
    if photo:
        try:
            await storage.delete_object(photo)
        except Exception:
            pass
    return {"data": {"deleted": True, "id": str(movement_id)}}


class SignAllIn(BaseModel):
    step_ids: list[uuid.UUID] | None = None  # subset of current-round pendings; None = all
    note: str | None = None


# NOTE: must be declared BEFORE /steps/{step_id} — path order matters.
@router.post("/orgs/{org_id}/documents/{doc_id}/steps/sign-all")
async def sign_all(org_id: uuid.UUID, doc_id: uuid.UUID, body: SignAllIn, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize("officer"))):
    doc = await session.get(Document, doc_id)
    if doc is None or doc.org_id != org_id:
        raise not_found("document")
    steps = (await session.execute(select(DocumentSignatoryStep).where(
        DocumentSignatoryStep.document_id == doc_id))).scalars().all()
    max_round = max((s.round_no for s in steps), default=1)
    pending = [s for s in steps if s.status == "pending" and s.round_no == max_round]
    if not pending:
        raise APIError(409, "NOTHING_TO_SIGN", "No pending steps in the current round")

    targets = pending
    if body.step_ids is not None:
        valid = {s.id for s in pending}
        if not set(body.step_ids) <= valid:
            raise APIError(409, "NOT_CURRENT_ROUND", "Can only bulk-sign pending steps of the current round")
        targets = [s for s in pending if s.id in set(body.step_ids)]

    now = datetime.now(timezone.utc)
    for s in targets:
        s.status = "signed"
        s.signed_at = now
        s.noted_by = uuid.UUID(member.user_id)
        if body.note:
            s.note = body.note

    if not [s for s in steps if s.status == "pending" and s.round_no == max_round]:
        doc.status = "signed"
        await fan_out_doc_signed(session, bg, org_id=org_id,
                                 actor_id=member.user_id, doc=doc)
    else:
        nxt = _next_desk(steps, max_round)
        if nxt is not None:
            await fan_out_desk(session, bg, org_id=org_id,
                               actor_id=member.user_id, doc=doc, step=nxt)

    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="signatory.bulk_signed", entity_type="document",
                entity_id=doc.id,
                metadata={"round": max_round,
                          "steps": [str(s.id) for s in targets], "note": body.note})
    await session.commit()
    return {"data": {"signed": len(targets)}}


class StepAdvance(BaseModel):
    status: str = Field(pattern="^(signed|skipped)$")
    note: str | None = None


@router.post("/orgs/{org_id}/documents/{doc_id}/steps/{step_id}")
async def advance_step(org_id: uuid.UUID, doc_id: uuid.UUID, step_id: uuid.UUID, body: StepAdvance, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize("officer"))):
    step = await session.get(DocumentSignatoryStep, step_id)
    if step is None or step.org_id != org_id or step.document_id != doc_id:
        raise not_found("signatory step")
    if step.status != "pending":
        raise APIError(409, "STEP_CLOSED", "Step already resolved")
    if body.status == "skipped" and not body.note:
        raise APIError(422, "NOTE_REQUIRED", "Skipping a step requires a note")
    step.status = body.status
    step.note = body.note
    step.noted_by = uuid.UUID(member.user_id)
    step.signed_at = datetime.now(timezone.utc) if body.status == "signed" else None

    # advance document status when the CURRENT round's steps are all resolved —
    # revision_requested/superseded rows are history, never blockers
    doc = await session.get(Document, doc_id)
    steps = (await session.execute(select(DocumentSignatoryStep).where(
        DocumentSignatoryStep.document_id == doc_id))).scalars().all()
    max_round = max(s.round_no for s in steps)
    if doc is not None and not [s for s in steps
                                if s.status == "pending" and s.round_no == max_round]:
        doc.status = "signed"
        await fan_out_doc_signed(session, bg, org_id=org_id,
                                 actor_id=member.user_id, doc=doc)
    elif doc is not None and (nxt := _next_desk(steps, max_round)) is not None:
        await fan_out_desk(session, bg, org_id=org_id,
                           actor_id=member.user_id, doc=doc, step=nxt)

    await audit(session, org_id=org_id, actor_id=member.user_id,
                action=f"signatory.{body.status}", entity_type="document_signatory_step",
                entity_id=step.id, metadata={"document_id": str(doc_id), "label": step.label})
    await session.commit()
    return {"data": step}


# ── Revision rounds ────────────────────────────────────────────────────
class RevisionIn(BaseModel):
    at_step_id: uuid.UUID | None = None        # pending step sending it back
    return_to_step_id: uuid.UUID | None = None  # resolved step to bounce back to
    note: str = Field(min_length=1, max_length=500)
    resend_step_ids: list[uuid.UUID] = []       # resolved = re-sign; pending = carry into the new round


RESOLVED = ("signed", "skipped", "revision_requested")


@router.post("/orgs/{org_id}/documents/{doc_id}/revisions", status_code=201)
async def request_revision(org_id: uuid.UUID, doc_id: uuid.UUID, body: RevisionIn, session: Session, bg: BackgroundTasks, member: Membership = Depends(authorize("officer"))):
    doc = await session.get(Document, doc_id)
    if doc is None or doc.org_id != org_id:
        raise not_found("document")
    steps = (await session.execute(select(DocumentSignatoryStep).where(
        DocumentSignatoryStep.document_id == doc_id))).scalars().all()
    if not steps:
        raise APIError(409, "NOTHING_TO_REVISE", "Document has no signatory chain")
    by_id = {s.id: s for s in steps}

    if body.at_step_id and body.return_to_step_id:
        raise APIError(422, "ONE_TRIGGER",
                       "Send back from one step — pick at_step_id or return_to_step_id, not both")

    trigger = None
    if body.at_step_id:
        trigger = by_id.get(body.at_step_id)
        if trigger is None:
            raise not_found("signatory step")
        if trigger.status != "pending":
            raise APIError(409, "STEP_CLOSED", "Step already resolved")
    elif body.return_to_step_id:
        trigger = by_id.get(body.return_to_step_id)
        if trigger is None:
            raise not_found("signatory step")
        if trigger.status not in RESOLVED:
            raise APIError(422, "NOT_RESOLVED",
                           "Can only return to a step that already resolved — sign it or pick a pending step")
    elif doc.status not in ("signed", "filed"):
        raise APIError(422, "AT_STEP_REQUIRED",
                       "Pick the step that's sending it back")

    resends = []
    for sid in dict.fromkeys(body.resend_step_ids):
        if trigger is not None and sid == trigger.id:
            continue  # the trigger clones into the new round on its own
        s = by_id.get(sid)
        if s is None:
            raise not_found("signatory step")
        if s.status not in RESOLVED and s.status != "pending":
            raise APIError(422, "NOT_RESOLVED",
                           "Re-sign list must be steps of this document")
        resends.append(s)
    if not resends and body.at_step_id is None and body.return_to_step_id is None:
        raise APIError(422, "RESEND_REQUIRED",
                       "A late revision needs at least one office re-signing")

    round_no = max(s.round_no for s in steps) + 1
    rev = DocumentRevision(org_id=org_id, document_id=doc.id,
                           requested_at_step_id=body.at_step_id or body.return_to_step_id,
                           round_no=round_no, note=body.note,
                           created_by=uuid.UUID(member.user_id))
    session.add(rev)

    if trigger is not None:
        trigger.status = "revision_requested"
        trigger.note = body.note
        trigger.noted_by = uuid.UUID(member.user_id)
    # supersede every stale pending — the new round is the live route;
    # pending steps the officer chose to carry get cloned below
    for s in steps:
        if s.status == "pending":
            s.status = "superseded"

    new_steps = []
    for orig in resends + ([trigger] if trigger is not None else []):
        ns = DocumentSignatoryStep(
            org_id=org_id, document_id=doc.id, ord=orig.ord, label=orig.label,
            office=orig.office, status="pending", round_no=round_no, revises=orig.id)
        session.add(ns)
        new_steps.append(ns)

    doc.status = "revision"

    # who's affected: the mover (creator) + the desk it lands back on —
    # the explicit return-to step when given, else the new round's first
    # pending desk. One fan-out, no double-ping for the same holder.
    back_to = by_id.get(body.return_to_step_id) \
        or (min(new_steps, key=lambda s: s.ord) if new_steps else None)
    await fan_out_sent_back(session, bg, org_id=org_id,
                            actor_id=member.user_id, doc=doc,
                            back_to_step=back_to, note=body.note)

    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="document.revision_requested", entity_type="document",
                entity_id=doc.id,
                metadata={"round": round_no,
                          "at_step": str(body.at_step_id) if body.at_step_id else None,
                          "return_to": str(body.return_to_step_id) if body.return_to_step_id else None,
                          "resend": [str(s.id) for s in resends], "note": body.note})
    await session.commit()
    return {"data": rev, "new_steps": new_steps}
