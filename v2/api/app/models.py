"""SQLModel tables mirroring supabase/migrations/0001_init.sql.

Composite foreign keys to org_members(org_id, user_id) are enforced by the
migration; model-side we keep plain columns + indexes — the service layer
validates membership via require_user_in_org().
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Column, Date, DateTime, ForeignKeyConstraint, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class Organization(SQLModel, table=True):
    __tablename__ = "organizations"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    name: str
    slug: str = Field(unique=True, index=True)
    logo_url: str | None = None
    created_by: uuid.UUID
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class Profile(SQLModel, table=True):
    __tablename__ = "profiles"
    id: uuid.UUID = Field(primary_key=True)
    display_name: str
    avatar_url: str | None = None
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class SchoolYear(SQLModel, table=True):
    __tablename__ = "school_years"
    __table_args__ = (UniqueConstraint("org_id", "label"),)
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    label: str
    is_current: bool = False
    starts_on: date | None = Field(default=None, sa_column=Column(Date))
    ends_on: date | None = Field(default=None, sa_column=Column(Date))


class OrgMember(SQLModel, table=True):
    __tablename__ = "org_members"
    org_id: uuid.UUID = Field(foreign_key="organizations.id", primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="profiles.id", primary_key=True)
    school_year_id: uuid.UUID | None = Field(default=None, foreign_key="school_years.id")
    role: str = "member"
    status: str = "pending"
    joined_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class Position(SQLModel, table=True):
    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("org_id", "school_year_id", "title"),)
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    school_year_id: uuid.UUID = Field(foreign_key="school_years.id")
    title: str
    rank: int = 0
    holder: uuid.UUID | None = None
    reports_to: uuid.UUID | None = Field(default=None, foreign_key="positions.id")


class DutySchedule(SQLModel, table=True):
    __tablename__ = "duty_schedules"
    __table_args__ = (UniqueConstraint("org_id", "school_year_id", "weekday", "member_id"),)
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    school_year_id: uuid.UUID = Field(foreign_key="school_years.id")
    weekday: int
    member_id: uuid.UUID


class AttendanceDay(SQLModel, table=True):
    __tablename__ = "attendance_days"
    __table_args__ = (UniqueConstraint("member_id", "day"),)
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    member_id: uuid.UUID
    day: date = Field(sa_column=Column(Date))
    status: str
    duty_type: str
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class Project(SQLModel, table=True):
    __tablename__ = "projects"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    title: str
    details: str | None = None
    event_type: str | None = None
    target_date: date | None = Field(default=None, sa_column=Column(Date))
    owner_id: uuid.UUID | None = None
    status: str = "draft"
    needs_paper_processing: bool = False
    needs_logistics: bool = False
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class JournalEntry(SQLModel, table=True):
    __tablename__ = "journal_entries"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    member_id: uuid.UUID
    entry_date: date = Field(sa_column=Column(Date))
    description: str
    project_id: uuid.UUID | None = Field(default=None, foreign_key="projects.id")
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class JournalPhoto(SQLModel, table=True):
    __tablename__ = "journal_photos"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    entry_id: uuid.UUID = Field(foreign_key="journal_entries.id")
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    storage_path: str = Field(unique=True)
    mime: str
    byte_size: int
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class ChecklistTemplate(SQLModel, table=True):
    __tablename__ = "checklist_templates"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    name: str
    track: str
    event_type: str | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class ChecklistTemplateItem(SQLModel, table=True):
    __tablename__ = "checklist_template_items"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    template_id: uuid.UUID = Field(foreign_key="checklist_templates.id")
    ord: int
    label: str
    hint: str | None = None
    required: bool = True
    rule_json: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))


class ProjectChecklistItem(SQLModel, table=True):
    __tablename__ = "project_checklist_items"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    project_id: uuid.UUID = Field(foreign_key="projects.id")
    template_id: uuid.UUID | None = Field(default=None, foreign_key="checklist_templates.id")
    ord: int
    label: str
    hint: str | None = None
    required: bool = True
    due_date: date | None = Field(default=None, sa_column=Column(Date))
    done: bool = False
    done_by: uuid.UUID | None = None
    done_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class Document(SQLModel, table=True):
    __tablename__ = "documents"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    project_id: uuid.UUID | None = Field(default=None, foreign_key="projects.id")
    title: str
    doc_type: str
    status: str = "drafting"
    created_by: uuid.UUID
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class DocumentMovement(SQLModel, table=True):
    __tablename__ = "document_movements"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    document_id: uuid.UUID = Field(foreign_key="documents.id")
    location_text: str
    note: str | None = None
    photo_path: str | None = None
    moved_by: uuid.UUID
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class SignatoryChain(SQLModel, table=True):
    __tablename__ = "signatory_chains"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    name: str
    doc_type: str


class SignatoryStep(SQLModel, table=True):
    __tablename__ = "signatory_steps"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    chain_id: uuid.UUID = Field(foreign_key="signatory_chains.id")
    ord: int
    label: str
    office: str | None = None
    condition_json: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))


class DocumentSignatoryStep(SQLModel, table=True):
    __tablename__ = "document_signatory_steps"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    document_id: uuid.UUID = Field(foreign_key="documents.id")
    ord: int
    label: str
    office: str | None = None
    status: str = "pending"
    signed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    noted_by: uuid.UUID | None = None
    note: str | None = None


class Invite(SQLModel, table=True):
    __tablename__ = "invites"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    code: str = Field(unique=True)
    role: str
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True)))
    max_uses: int = 1
    uses: int = 0
    created_by: uuid.UUID
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class JoinRequest(SQLModel, table=True):
    __tablename__ = "join_requests"
    __table_args__ = (UniqueConstraint("org_id", "user_id"),)
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    user_id: uuid.UUID = Field(foreign_key="profiles.id")
    message: str | None = None
    status: str = "pending"
    decided_by: uuid.UUID | None = None
    decided_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))


class OrgContact(SQLModel, table=True):
    __tablename__ = "org_contacts"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    label: str
    value: str
    category: str | None = None
    ord: int = 0


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_log"
    id: uuid.UUID = Field(default_factory=_uuid, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    actor_id: uuid.UUID | None = None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None = None
    metadata_: dict[str, Any] = Field(default_factory=dict, sa_column=Column("metadata", JSONB, server_default=text("'{}'")))
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), server_default=func.now()))
