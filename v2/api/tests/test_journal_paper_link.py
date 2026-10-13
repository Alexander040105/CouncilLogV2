"""Dailies can tag a paper (journal_entries.document_id) and project-scoped
surfaces see paper work: the journal feed's ?project_id= matches entries that
name the project directly OR one of its papers, and GET /documents?project_id=
returns each paper with its last hand-off (who moved it + where it sits).

Same harness as test_multi_assignee.py: handlers invoked directly, sqlite
in-memory, bare BackgroundTasks.
"""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlmodel import select


@compiles(JSONB, "sqlite")
def _jsonb_as_json(element, compiler, **kw):
    return "JSON"

from app.deps import Membership
from app.errors import APIError
from app.models import (AttendanceDay, AuditLog, Document, DocumentMovement,
                        DutySchedule, JournalEntry, JournalEntryComment,
                        JournalPhoto, OrgMember, Organization, Profile,
                        Project, SchoolYear, Task)
from app.routers.daily import EntryIn, EntryPatch, create_entry, feed, patch_entry
from app.routers.documents import list_documents

TABLES = (Organization.__table__, Profile.__table__, OrgMember.__table__,
          SchoolYear.__table__, DutySchedule.__table__, AttendanceDay.__table__,
          Project.__table__, Document.__table__, DocumentMovement.__table__,
          Task.__table__, JournalEntry.__table__,
          JournalEntryComment.__table__, JournalPhoto.__table__,
          AuditLog.__table__)


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        for t in TABLES:
            for c in t.c:
                sd = c.server_default
                if sd is not None and "jsonb" in str(getattr(sd, "arg", sd)).lower():
                    c.server_default = None
            await conn.run_sync(t.create)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


def _member(org_id, uid, role="member") -> Membership:
    return Membership(org_id=org_id, user_id=str(uid), role=role)


async def _org(session):
    org = Organization(name="Council", slug=f"o-{uuid.uuid4().hex[:8]}",
                       created_by=uuid.uuid4())
    session.add(org)
    await session.flush()
    return org


async def _doc(session, org_id, project_id=None, title="Concept paper"):
    d = Document(org_id=org_id, project_id=project_id, title=title,
                 doc_type="concept_paper", created_by=uuid.uuid4())
    session.add(d)
    await session.flush()
    return d


async def _entries(session, org_id, **kw):
    return (await feed(org_id=org_id, session=session,
                       member=_member(org_id, uuid.uuid4()), **kw))["data"]


async def test_entry_tagging_paper_inherits_its_project(session):
    org = await _org(session)
    writer = uuid.uuid4()
    p = Project(org_id=org.id, title="IT Olympics")
    session.add(p)
    await session.flush()
    doc = await _doc(session, org.id, project_id=p.id)

    r = await create_entry(org_id=org.id, session=session,
                           member=_member(org.id, writer),
                           body=EntryIn(description="Followed up with the registrar",
                                        document_id=doc.id))
    e = r["data"]
    assert e.document_id == doc.id
    assert e.project_id == p.id     # inherited — the paper IS project work


async def test_paper_project_mismatch_rejected(session):
    org = await _org(session)
    a, b = (uuid.uuid4() for _ in range(2))
    pa, pb = (Project(org_id=org.id, title="A"), Project(org_id=org.id, title="B"))
    session.add_all([pa, pb])
    await session.flush()
    doc = await _doc(session, org.id, project_id=pa.id)

    with pytest.raises(APIError) as e:
        await create_entry(org_id=org.id, session=session,
                           member=_member(org.id, b),
                           body=EntryIn(description="x", project_id=pb.id,
                                        document_id=doc.id))
    assert e.value.code == "PAPER_PROJECT_MISMATCH"
    assert e.value.status_code == 422


async def test_paper_from_another_org_is_404(session):
    org, other = await _org(session), await _org(session)
    doc = await _doc(session, other.id)     # lives in the other org

    with pytest.raises(APIError) as e:
        await create_entry(org_id=org.id, session=session,
                           member=_member(org.id, uuid.uuid4()),
                           body=EntryIn(description="x", document_id=doc.id))
    assert e.value.status_code == 404


async def test_project_feed_includes_paper_dailies(session):
    org = await _org(session)
    writer = uuid.uuid4()
    p, other_p = (Project(org_id=org.id, title="Fair"),
                  Project(org_id=org.id, title="Drive"))
    session.add_all([p, other_p])
    await session.flush()
    doc = await _doc(session, org.id, project_id=p.id)
    stranger = await _doc(session, org.id, project_id=other_p.id)
    m = _member(org.id, writer)

    direct = (await create_entry(org_id=org.id, session=session, member=m,
                                 body=EntryIn(description="Venue booked",
                                              project_id=p.id)))["data"]
    via_paper = (await create_entry(org_id=org.id, session=session, member=m,
                                    body=EntryIn(description="Chased signatures",
                                                 document_id=doc.id)))["data"]
    unrelated = (await create_entry(org_id=org.id, session=session, member=m,
                                    body=EntryIn(description="Other paper",
                                                 document_id=stranger.id)))["data"]
    assert unrelated.project_id == other_p.id

    ids = {e["id"] for e in await _entries(session, org.id, project_id=p.id)}
    assert direct.id in ids and via_paper.id in ids
    assert unrelated.id not in ids

    # ?document_id= zooms to one paper's dailies
    ids = {e["id"] for e in await _entries(session, org.id, document_id=doc.id)}
    assert ids == {via_paper.id}


async def test_patch_document_id_is_tri_state(session):
    org = await _org(session)
    writer = uuid.uuid4()
    m = _member(org.id, writer)
    doc, doc2 = await _doc(session, org.id), await _doc(session, org.id)

    r = await create_entry(org_id=org.id, session=session, member=m,
                           body=EntryIn(description="x", document_id=doc.id))
    eid = r["data"].id

    # absent field leaves the link alone
    r = await patch_entry(org_id=org.id, entry_id=eid, session=session,
                          member=m, body=EntryPatch(description="y"))
    assert r["data"].document_id == doc.id
    # set swaps it
    r = await patch_entry(org_id=org.id, entry_id=eid, session=session,
                          member=m, body=EntryPatch(document_id=doc2.id))
    assert r["data"].document_id == doc2.id
    # explicit null clears
    r = await patch_entry(org_id=org.id, entry_id=eid, session=session,
                          member=m, body=EntryPatch(document_id=None))
    assert r["data"].document_id is None


async def test_documents_project_filter_and_last_handler(session):
    org = await _org(session)
    p, other_p = (Project(org_id=org.id, title="Fair"),
                  Project(org_id=org.id, title="Drive"))
    session.add_all([p, other_p])
    await session.flush()
    doc = await _doc(session, org.id, project_id=p.id)
    await _doc(session, org.id, project_id=other_p.id, title="Other paper")
    mover = uuid.uuid4()
    session.add(DocumentMovement(org_id=org.id, document_id=doc.id,
                                 location_text="Registrar's desk",
                                 moved_by=mover,
                                 created_at=datetime.now(timezone.utc)))
    await session.flush()

    r = await list_documents(org_id=org.id, session=session, project_id=p.id,
                             member=_member(org.id, uuid.uuid4()))
    assert [d["title"] for d in r["data"]] == ["Concept paper"]
    row = r["data"][0]
    assert row["current_location"] == "Registrar's desk"
    assert row["last_moved_by"] == mover
    assert row["last_moved_at"] is not None

    # an unmoved paper reports empty hand-off fields, not a missing key
    r = await list_documents(org_id=org.id, session=session, project_id=other_p.id,
                             member=_member(org.id, uuid.uuid4()))
    assert r["data"][0]["current_location"] is None
    assert r["data"][0]["last_moved_by"] is None


async def test_patch_document_mismatch_uses_effective_project(session):
    org = await _org(session)
    writer = uuid.uuid4()
    m = _member(org.id, writer)
    pa, pb = (Project(org_id=org.id, title="A"), Project(org_id=org.id, title="B"))
    session.add_all([pa, pb])
    await session.flush()
    doc_a, doc_b = (await _doc(session, org.id, project_id=pa.id),
                    await _doc(session, org.id, project_id=pb.id))

    r = await create_entry(org_id=org.id, session=session, member=m,
                           body=EntryIn(description="x", document_id=doc_a.id))
    eid = r["data"].id

    # entry inherited project A — pointing it at project B's paper must fail
    with pytest.raises(APIError) as e:
        await patch_entry(org_id=org.id, entry_id=eid, session=session,
                          member=m, body=EntryPatch(document_id=doc_b.id))
    assert e.value.code == "PAPER_PROJECT_MISMATCH"
