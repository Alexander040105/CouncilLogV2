import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import delete, select

from ..deps import Membership, Session, authorize
from ..errors import APIError, not_found
from ..models import (Document, DocumentMovement, DocumentRevision,
                      DocumentSignatoryStep, Project, SignatoryChain,
                      SignatoryStep)
from ..pagination import envelope, page_params
from ..services import instantiate, storage
from ..services.audit import audit

router = APIRouter(tags=["documents"])


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


@router.get("/orgs/{org_id}/documents")
async def list_documents(org_id: uuid.UUID, session: Session, status: str | None = None, page: int = 1, pageSize: int = 20, member: Membership = Depends(authorize())):
    page, page_size = page_params(page, pageSize)
    q = select(Document).where(Document.org_id == org_id)
    if status:
        q = q.where(Document.status == status)
    total = (await session.execute(
        select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await session.execute(
        q.order_by(Document.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return envelope(rows, page, page_size, total)


@router.post("/orgs/{org_id}/documents", status_code=201)
async def create_document(org_id: uuid.UUID, body: DocIn, session: Session, member: Membership = Depends(authorize("officer"))):
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
                   created_by=uuid.UUID(member.user_id))
    session.add(doc)
    await session.flush()

    # instantiate signatory steps from matching chain
    chain_id = body.chain_id
    if chain_id is None:
        chain = (await session.execute(select(SignatoryChain).where(
            SignatoryChain.org_id == org_id, SignatoryChain.doc_type == body.doc_type)
            .order_by(SignatoryChain.name))).scalars().first()
        chain_id = chain.id if chain else None
    if chain_id:
        raw = (await session.execute(select(SignatoryStep).where(
            SignatoryStep.chain_id == chain_id).order_by(SignatoryStep.ord))).scalars().all()
        for s in instantiate.instantiate_chain(
                [x.model_dump() for x in raw], event_type=event_type, flags=flags):
            session.add(DocumentSignatoryStep(
                org_id=org_id, document_id=doc.id, ord=s["ord"], label=s["label"],
                office=s.get("office")))
        doc.status = "routing"

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
async def attach_chain(org_id: uuid.UUID, doc_id: uuid.UUID, body: AttachChain, session: Session, member: Membership = Depends(authorize("officer"))):
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
    for s in instantiate.instantiate_chain(
            [x.model_dump() for x in raw], event_type=event_type, flags=doc.flags or {}):
        session.add(DocumentSignatoryStep(
            org_id=org_id, document_id=doc.id, ord=s["ord"], label=s["label"],
            office=s.get("office")))
    doc.status = "routing"

    await audit(session, org_id=org_id, actor_id=member.user_id, action="document.chain_attached",
                entity_type="document", entity_id=doc.id,
                metadata={"chain_id": str(chain.id), "chain": chain.name})
    await session.commit()
    return {"data": doc}


class MovementIn(BaseModel):
    location_text: str = Field(min_length=1, max_length=300)
    note: str | None = None
    photo_path: str | None = None


@router.post("/orgs/{org_id}/documents/{doc_id}/movements", status_code=201)
async def add_movement(org_id: uuid.UUID, doc_id: uuid.UUID, body: MovementIn, session: Session, member: Membership = Depends(authorize("officer"))):
    doc = await session.get(Document, doc_id)
    if doc is None or doc.org_id != org_id:
        raise not_found("document")
    if body.photo_path and not body.photo_path.startswith(f"{org_id}/"):
        raise APIError(422, "BAD_PATH", "Photo path not scoped to org")
    mv = DocumentMovement(org_id=org_id, document_id=doc_id, moved_by=uuid.UUID(member.user_id),
                          **body.model_dump())
    session.add(mv)
    await audit(session, org_id=org_id, actor_id=member.user_id, action="document.moved",
                entity_type="document", entity_id=doc.id,
                metadata={"location": body.location_text})
    await session.commit()
    return {"data": mv}


class SignAllIn(BaseModel):
    step_ids: list[uuid.UUID] | None = None  # subset of current-round pendings; None = all
    note: str | None = None


# NOTE: must be declared BEFORE /steps/{step_id} — path order matters.
@router.post("/orgs/{org_id}/documents/{doc_id}/steps/sign-all")
async def sign_all(org_id: uuid.UUID, doc_id: uuid.UUID, body: SignAllIn, session: Session, member: Membership = Depends(authorize("officer"))):
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
async def advance_step(org_id: uuid.UUID, doc_id: uuid.UUID, step_id: uuid.UUID, body: StepAdvance, session: Session, member: Membership = Depends(authorize("officer"))):
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

    await audit(session, org_id=org_id, actor_id=member.user_id,
                action=f"signatory.{body.status}", entity_type="document_signatory_step",
                entity_id=step.id, metadata={"document_id": str(doc_id), "label": step.label})
    await session.commit()
    return {"data": step}


# ── Revision rounds ────────────────────────────────────────────────────
class RevisionIn(BaseModel):
    at_step_id: uuid.UUID | None = None   # pending step sending it back; null = late revision on signed/filed doc
    note: str = Field(min_length=1, max_length=500)
    resend_step_ids: list[uuid.UUID] = []


RESOLVED = ("signed", "skipped", "revision_requested")


@router.post("/orgs/{org_id}/documents/{doc_id}/revisions", status_code=201)
async def request_revision(org_id: uuid.UUID, doc_id: uuid.UUID, body: RevisionIn, session: Session, member: Membership = Depends(authorize("officer"))):
    doc = await session.get(Document, doc_id)
    if doc is None or doc.org_id != org_id:
        raise not_found("document")
    steps = (await session.execute(select(DocumentSignatoryStep).where(
        DocumentSignatoryStep.document_id == doc_id))).scalars().all()
    if not steps:
        raise APIError(409, "NOTHING_TO_REVISE", "Document has no signatory chain")
    by_id = {s.id: s for s in steps}

    at_step = by_id.get(body.at_step_id) if body.at_step_id else None
    if body.at_step_id:
        if at_step is None:
            raise not_found("signatory step")
        if at_step.status != "pending":
            raise APIError(409, "STEP_CLOSED", "Step already resolved")
    elif doc.status not in ("signed", "filed"):
        raise APIError(422, "AT_STEP_REQUIRED",
                       "Pick the pending step that's sending it back")

    resends = []
    for sid in dict.fromkeys(body.resend_step_ids):
        s = by_id.get(sid)
        if s is None or s.status not in RESOLVED:
            raise APIError(422, "NOT_RESOLVED", "Re-sign list must be resolved steps of this document")
        resends.append(s)
    if not resends and body.at_step_id is None:
        raise APIError(422, "RESEND_REQUIRED",
                       "A late revision needs at least one office re-signing")

    round_no = max(s.round_no for s in steps) + 1
    rev = DocumentRevision(org_id=org_id, document_id=doc.id,
                           requested_at_step_id=body.at_step_id,
                           round_no=round_no, note=body.note,
                           created_by=uuid.UUID(member.user_id))
    session.add(rev)

    if at_step is not None:
        at_step.status = "revision_requested"
        at_step.note = body.note
        at_step.noted_by = uuid.UUID(member.user_id)
    # supersede every other stale pending — the new round is the live route
    for s in steps:
        if s.status == "pending":
            s.status = "superseded"

    new_steps = []
    for orig in resends + ([at_step] if at_step is not None else []):
        ns = DocumentSignatoryStep(
            org_id=org_id, document_id=doc.id, ord=orig.ord, label=orig.label,
            office=orig.office, status="pending", round_no=round_no, revises=orig.id)
        session.add(ns)
        new_steps.append(ns)

    doc.status = "revision"
    await audit(session, org_id=org_id, actor_id=member.user_id,
                action="document.revision_requested", entity_type="document",
                entity_id=doc.id,
                metadata={"round": round_no,
                          "at_step": str(body.at_step_id) if body.at_step_id else None,
                          "resend": [str(s.id) for s in resends], "note": body.note})
    await session.commit()
    return {"data": rev, "new_steps": new_steps}
