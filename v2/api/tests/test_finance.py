"""Finance: bankbook ledger, per-project budgets, expenses, receipts,
and the FRF report. Handler-level like test_ux_edits.py — constructed
Membership, sqlite in-memory, storage monkeypatched."""
import uuid
from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlmodel import select


@compiles(JSONB, "sqlite")
def _jsonb_as_json(element, compiler, **kw):
    """Postgres JSONB doesn't compile on sqlite — render as JSON for tests."""
    return "JSON"

from app.deps import Membership
from app.errors import APIError
from app.models import (AuditLog, BudgetExpense, Document, ExpenseReceipt,
                        FundTransaction, OrgMember, Organization, Position,
                        Profile, Project, ProjectBudget, SchoolYear)
from app.pagination import org_today
from app.routers.finance import (BudgetIn, BudgetPatch, ExpenseIn,
                                 ExpensePatch, TxnIn, UploadedFile,
                                 attach_receipt, close_budget, create_budget,
                                 create_expense, create_txn, delete_budget,
                                 delete_expense, delete_txn, financial_report,
                                 financial_report_docx, get_fund,
                                 get_project_budget, patch_budget,
                                 patch_expense, patch_txn, resolution_url)
from app.services import storage

TABLES = (ProjectBudget.__table__, FundTransaction.__table__,
          BudgetExpense.__table__, ExpenseReceipt.__table__,
          Project.__table__, Document.__table__, Organization.__table__,
          Profile.__table__, OrgMember.__table__, SchoolYear.__table__,
          Position.__table__, AuditLog.__table__)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in TABLES:
            if "flags" in t.c:
                t.c.flags.server_default = None
            await conn.run_sync(t.create)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


@pytest.fixture
def fake_storage(monkeypatch):
    deleted = []

    async def _head(path):
        return b"\xff\xd8\xff\xe0" + b"\x00" * 12 if path.endswith("jpg") else b"%PDF-1.4\n"

    async def _delete(path, bucket=None):
        deleted.append(path)

    async def _url(path):
        return f"https://storage.test/{path}?sig"

    monkeypatch.setattr(storage, "object_head", _head)
    monkeypatch.setattr(storage, "delete_object", _delete)
    monkeypatch.setattr(storage, "signed_download_url", _url)
    return deleted


def _member(org_id, uid, role="member") -> Membership:
    return Membership(org_id=org_id, user_id=str(uid), role=role)


def _org() -> Organization:
    return Organization(name="CCS", slug=f"ccs-{uuid.uuid4().hex[:6]}",
                        created_by=uuid.uuid4())


def _project(org_id) -> Project:
    return Project(org_id=org_id, title="E.L.I.T.E. Program")


async def _budget(session, org_id, project_id, uid, allocated=111600):
    """create_budget via the handler."""
    return await create_budget(
        org_id, project_id,
        BudgetIn(allocated_centavos=allocated), session,
        _member(org_id, uid, "officer"))


@pytest.mark.asyncio
async def test_create_budget_writes_withdrawal(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    r = await _budget(session, org.id, p.id, uid)
    b = r["data"]
    txns = (await session.execute(select(FundTransaction).where(
        FundTransaction.budget_id == b.id))).scalars().all()
    assert len(txns) == 1 and txns[0].kind == "withdrawal"
    assert txns[0].amount_centavos == 111600
    fund = await get_fund(org.id, session, _member(org.id, uid))
    assert fund["balance_centavos"] == -111600


@pytest.mark.asyncio
async def test_fund_balance_math(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    await session.commit()
    m = _member(org.id, uid, "officer")
    await create_txn(org.id, TxnIn(kind="deposit", amount_centavos=1944725,
                                   transacted_on=date(2026, 6, 30)), session, m)
    await create_txn(org.id, TxnIn(kind="withdrawal", amount_centavos=488000), session, m)
    fund = await get_fund(org.id, session, _member(org.id, uid))
    assert fund["balance_centavos"] == 1456725
    assert fund["transactions"][0]["transacted_on"] >= fund["transactions"][1]["transacted_on"]


@pytest.mark.asyncio
async def test_resolution_doc_type_guard(session, fake_storage):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    doc = Document(org_id=org.id, title="Letter", doc_type="letter",
                   created_by=uid)
    session.add(doc)
    await session.commit()
    with pytest.raises(APIError) as e:
        await create_budget(org.id, p.id,
                            BudgetIn(allocated_centavos=1000, resolution_id=doc.id),
                            session, _member(org.id, uid, "officer"))
    assert e.value.status_code == 422 and e.value.code == "WRONG_DOC_TYPE"


@pytest.mark.asyncio
async def test_resolution_upload_and_url(session, fake_storage):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    m = _member(org.id, uid, "officer")
    # non-org path is rejected
    with pytest.raises(APIError) as e:
        await create_budget(org.id, p.id, BudgetIn(
            allocated_centavos=1000,
            resolution=UploadedFile(storage_path="deadbeef/scan.pdf",
                                    mime="application/pdf", byte_size=100)),
            session, m)
    assert e.value.status_code == 422 and e.value.code == "BAD_PATH"
    # org-scoped pdf accepted
    r = await create_budget(org.id, p.id, BudgetIn(
        allocated_centavos=1000,
        resolution=UploadedFile(storage_path=f"{org.id}/resolutions/scan.pdf",
                                mime="application/pdf", byte_size=100)),
        session, m)
    b = r["data"]
    url = await resolution_url(org.id, b.id, session, _member(org.id, uid))
    assert url["download_url"].endswith("?sig")


@pytest.mark.asyncio
async def test_resolution_url_404_when_absent(session, fake_storage):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    r = await _budget(session, org.id, p.id, uid)
    with pytest.raises(APIError) as e:
        await resolution_url(org.id, r["data"].id, session, _member(org.id, uid))
    assert e.value.status_code == 404 and e.value.code == "NO_RESOLUTION_FILE"


@pytest.mark.asyncio
async def test_patch_resolution_replaces_file(session, fake_storage):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    m = _member(org.id, uid, "officer")
    r = await create_budget(org.id, p.id, BudgetIn(
        allocated_centavos=1000,
        resolution=UploadedFile(storage_path=f"{org.id}/resolutions/a.pdf",
                                mime="application/pdf", byte_size=100)),
        session, m)
    b = r["data"]
    new_path = f"{org.id}/resolutions/b.pdf"
    await patch_budget(org.id, b.id, BudgetPatch(
        resolution=UploadedFile(storage_path=new_path,
                                mime="application/pdf", byte_size=100)),
        session, m)
    assert f"{org.id}/resolutions/a.pdf" in fake_storage
    # explicit null clears
    await patch_budget(org.id, b.id, BudgetPatch(resolution=None), session, m)
    b2 = (await session.execute(select(ProjectBudget))).scalars().first()
    assert b2.resolution_path is None


@pytest.mark.asyncio
async def test_expense_closed_and_edit_guards(session, fake_storage):
    org, uid, other = _org(), uuid.uuid4(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    m = _member(org.id, uid, "officer")
    r = await _budget(session, org.id, p.id, uid, allocated=1000)
    b = r["data"]
    e = (await create_expense(org.id, b.id, ExpenseIn(
        item="Tarp", amount_centavos=400), session, m))["data"]
    # non-author member can't edit (owner can)
    with pytest.raises(APIError) as ex:
        await patch_expense(org.id, e.id, ExpensePatch(item="X"), session,
                            _member(org.id, other, "member"))
    assert ex.value.status_code == 403
    r2 = await patch_expense(org.id, e.id, ExpensePatch(item="Banner"), session,
                             _member(org.id, other, "owner"))
    assert r2["data"].item == "Banner"
    # close → expense create is refused
    await close_budget(org.id, b.id, session, m)
    with pytest.raises(APIError) as ex2:
        await create_expense(org.id, b.id, ExpenseIn(item="Late", amount_centavos=1),
                             session, m)
    assert ex2.value.status_code == 422 and ex2.value.code == "BUDGET_CLOSED"


@pytest.mark.asyncio
async def test_overspend_close_then_raise_and_close(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    m = _member(org.id, uid, "officer")
    r = await _budget(session, org.id, p.id, uid, allocated=1000)
    b = r["data"]
    await create_expense(org.id, b.id, ExpenseIn(item="Big", amount_centavos=1500),
                         session, m)
    with pytest.raises(APIError) as ex:
        await close_budget(org.id, b.id, session, m)
    assert ex.value.status_code == 422 and ex.value.code == "OVERSPENT"
    # raise allocation → withdrawal txn syncs → close succeeds
    await patch_budget(org.id, b.id, BudgetPatch(allocated_centavos=2000), session, m)
    closed = await close_budget(org.id, b.id, session, m)
    assert closed["return_txn"].amount_centavos == 500
    txn = (await session.execute(select(FundTransaction).where(
        FundTransaction.budget_id == b.id,
        FundTransaction.kind == "withdrawal"))).scalars().first()
    assert txn.amount_centavos == 2000


@pytest.mark.asyncio
async def test_linked_transaction_delete_guard(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    m = _member(org.id, uid, "officer")
    r = await _budget(session, org.id, p.id, uid)
    txn = (await session.execute(select(FundTransaction).where(
        FundTransaction.budget_id == r["data"].id))).scalars().first()
    with pytest.raises(APIError) as ex:
        await delete_txn(org.id, txn.id, session, m)
    assert ex.value.status_code == 422 and ex.value.code == "LINKED_TRANSACTION"


@pytest.mark.asyncio
async def test_expense_idempotent(session):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    m = _member(org.id, uid, "officer")
    r = await _budget(session, org.id, p.id, uid)
    b = r["data"]
    body = ExpenseIn(item="Tarp", amount_centavos=100, client_request_id="cli-1")
    first = await create_expense(org.id, b.id, body, session, m)
    second = await create_expense(org.id, b.id, body, session, m)
    assert second.status_code == 200 or second.get("deduplicated") is True \
        if hasattr(second, "status_code") else True
    n = (await session.execute(select(BudgetExpense))).scalars().all()
    assert len(n) == 1


@pytest.mark.asyncio
async def test_report_grouping_and_signatories(session, fake_storage):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    auditor = Profile(id=uuid.uuid4(), display_name="Karina Dig")
    sy = SchoolYear(org_id=org.id, label="2026-2027", is_current=True)
    session.add_all([auditor, sy])
    await session.flush()
    session.add(Position(org_id=org.id, school_year_id=sy.id,
                         title="Auditor", holder=auditor.id))
    await session.commit()
    m = _member(org.id, uid, "officer")
    r = await _budget(session, org.id, p.id, uid, allocated=488000)
    b = r["data"]
    await create_expense(org.id, b.id, ExpenseIn(vendor="MR. DIY",
                                               item="Storage box", amount_centavos=19500),
                         session, m)
    await create_expense(org.id, b.id, ExpenseIn(vendor="MR. DIY",
                                               item="Glass bottle", amount_centavos=22200),
                         session, m)
    await create_expense(org.id, b.id, ExpenseIn(item="Token", amount_centavos=50000),
                         session, m)
    await close_budget(org.id, b.id, session, m)
    rep = await financial_report(org.id, p.id, session, _member(org.id, uid))
    groups = {g["vendor"]: g for g in rep["expenses_by_vendor"]}
    assert groups["MR. DIY"]["subtotal_centavos"] == 41700
    assert groups[None]["subtotal_centavos"] == 50000
    assert rep["totals"] == {"spent_centavos": 91700,
                           "remaining_centavos": 396300}
    assert rep["signatories"]["auditor"] == "Karina Dig"
    assert rep["return"]["amount_centavos"] == 396300
    assert rep["fund"]["allocated_centavos"] == 488000


@pytest.mark.asyncio
async def test_docx_endpoint(session, fake_storage):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    m = _member(org.id, uid, "officer")
    await _budget(session, org.id, p.id, uid)
    resp = await financial_report_docx(org.id, p.id, session, _member(org.id, uid))
    assert resp.headers["content-disposition"].startswith("attachment;")
    assert "wordprocessingml" in resp.media_type
    assert len(resp.body) > 2000  # a real docx, not an empty stub


@pytest.mark.asyncio
async def test_attach_receipt(session, fake_storage):
    org, uid = _org(), uuid.uuid4()
    session.add(org)
    p = _project(org.id)
    session.add(p)
    await session.commit()
    m = _member(org.id, uid, "officer")
    r = await _budget(session, org.id, p.id, uid)
    b = r["data"]
    e = (await create_expense(org.id, b.id, ExpenseIn(
        item="Tarp", amount_centavos=400), session, m))["data"]
    rcpt = await attach_receipt(org.id, e.id, UploadedFile(
        storage_path=f"{org.id}/receipts/{e.id}/r1.pdf",
        mime="application/pdf", byte_size=500), session, m)
    assert rcpt["data"].storage_path.endswith("r1.pdf")
