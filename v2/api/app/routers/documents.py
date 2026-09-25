import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import select

from ..deps import Membership, Session, authorize
from ..errors import APIError, not_found
from ..models import (Document, DocumentMovement, DocumentSignatoryStep,
                      Project, SignatoryChain, SignatoryStep)
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
    rows = (await session.execute(
        q.order_by(Document.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()
    return envelope(rows, page, page_size, len(rows))


@router.post("/orgs/{org_id}/documents", status_code=201)
async def create_document(org_id: uuid.UUID, body: DocIn, session: Session, member: Membership = Depends(authorize("officer"))):
    if body.project_id:
        proj = await session.get(Project, body.project_id)
        if proj is None or proj.org_id != org_id:
            raise not_found("project")
        event_type = proj.event_type
    else:
        event_type = None

    doc = Document(org_id=org_id, project_id=body.project_id, title=body.title,
                   doc_type=body.doc_type, created_by=uuid.UUID(member.user_id))
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
                [x.model_dump() for x in raw], event_type=event_type, flags=body.flags):
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
        DocumentSignatoryStep.document_id == doc_id).order_by(DocumentSignatoryStep.ord))).scalars().all()
    return {"data": doc, "movements": movements, "signatory_steps": steps,
            "current_location": movements[-1].location_text if movements else None}


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

    # advance document status when all steps resolved
    remaining = (await session.execute(select(DocumentSignatoryStep).where(
        DocumentSignatoryStep.document_id == doc_id,
        DocumentSignatoryStep.status == "pending"))).scalars().all()
    doc = await session.get(Document, doc_id)
    if doc is not None and not remaining:
        doc.status = "signed"

    await audit(session, org_id=org_id, actor_id=member.user_id,
                action=f"signatory.{body.status}", entity_type="document_signatory_step",
                entity_id=step.id, metadata={"document_id": str(doc_id), "label": step.label})
    await session.commit()
    return {"data": step}
