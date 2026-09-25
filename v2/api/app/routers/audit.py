import uuid

from fastapi import APIRouter, Depends
from sqlmodel import select

from ..deps import Membership, Session, authorize
from ..models import AuditLog
from ..pagination import envelope, page_params

router = APIRouter(tags=["audit"])


@router.get("/orgs/{org_id}/audit")
async def list_audit(org_id: uuid.UUID, session: Session, page: int = 1, pageSize: int = 50, member: Membership = Depends(authorize("adviser"))):
    page, page_size = page_params(page, pageSize)
    rows = (await session.execute(
        select(AuditLog).where(AuditLog.org_id == org_id)
        .order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return envelope(rows, page, page_size, len(rows))
