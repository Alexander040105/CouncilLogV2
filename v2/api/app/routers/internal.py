"""Cron entry point — POST /internal/reminders, gated by x-cron-secret.

Runs the "remind me" sweep the spec calls for: tasks due tomorrow for their
assignees, and duty-roster members who haven't filed today. One notification
per user per kind per day (dedupe key in payload.ref); delivery is
inbox + push + email, all best-effort.
"""

from datetime import datetime, time, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header
from sqlmodel import select

from ..config import get_settings
from ..deps import Session
from ..errors import forbidden
from ..models import (AttendanceDay, Document, DocumentSignatoryStep,
                      DutySchedule, Notification, Organization, SchoolYear,
                      Task)
from ..pagination import org_today
from ..services.notify import (notify_duty_reminder, notify_task_due_soon,
                               record_notification, step_holder)
from ..services.push import send_push

router = APIRouter(tags=["internal"])

STALE_DESK_DAYS = 3


async def _ever_sent(session, user_id, kind: str, ref: str) -> bool:
    """Has this ref ever fired for this user (any day)? Used by the stale-
    desk nag, which pings a step once ever — not once per day."""
    rows = (await session.execute(select(Notification).where(
        Notification.user_id == user_id, Notification.kind == kind))).scalars().all()
    return any((n.payload or {}).get("ref") == ref for n in rows)


async def _already_sent(session, user_id, kind: str, ref: str, today) -> bool:
    # "Already sent today" must mean today *in the org timezone* — comparing
    # func.date(created_at) evaluates in UTC, which is a different date for
    # half of every PHT morning (00:00–08:00) and silently broke dedupe.
    # Bounds go in naive UTC to match how timestamps are stored/compared.
    tz = ZoneInfo(get_settings().org_timezone)
    day_start = (datetime.combine(today, time.min, tzinfo=tz)
                 .astimezone(timezone.utc).replace(tzinfo=None))
    day_end = day_start + timedelta(days=1)
    rows = (await session.execute(select(Notification).where(
        Notification.user_id == user_id, Notification.kind == kind,
        Notification.created_at >= day_start,
        Notification.created_at < day_end))).scalars().all()
    return any((n.payload or {}).get("ref") == ref for n in rows)


@router.post("/internal/reminders")
async def reminders(session: Session,
                    x_cron_secret: Annotated[str | None, Header()] = None):
    secret = get_settings().cron_secret
    if not secret or x_cron_secret != secret:
        raise forbidden("Bad cron secret")

    today = org_today()
    tomorrow = today + timedelta(days=1)
    sent = {"task_due_soon": 0, "duty_reminder": 0, "desk_stale": 0}

    # tasks due tomorrow → ping the assignee
    due = (await session.execute(select(Task, Organization).join(
        Organization, Organization.id == Task.org_id).where(
        Task.status == "open", Task.due_date == tomorrow,
        Task.assignee_id != None))).all()  # noqa: E711
    for t, org in due:
        ref = f"task_due:{t.id}:{today}"
        if await _already_sent(session, t.assignee_id, "task_due_soon", ref, today):
            continue
        record_notification(session, org_id=t.org_id, user_id=t.assignee_id,
                            kind="task_due_soon",
                            payload={"ref": ref, "entity_type": "task",
                                     "entity_id": str(t.id), "title": t.title})
        await send_push(session, t.assignee_id,
                        title=f"{org.name} · due tomorrow", body=t.title,
                        data={"entity_type": "task", "entity_id": str(t.id),
                              "kind": "task_due_soon"})
        await notify_task_due_soon(org_name=org.name, title=t.title,
                                   user_id=t.assignee_id)
        sent["task_due_soon"] += 1

    # duty roster members with no filing today → ping
    orgs = (await session.execute(select(Organization).where(
        Organization.archived_at == None))).scalars().all()  # noqa: E711
    for org in orgs:
        sy = (await session.execute(select(SchoolYear).where(
            SchoolYear.org_id == org.id, SchoolYear.is_current == True))  # noqa: E712
        ).scalars().first()
        if sy is None:
            continue
        roster = set((await session.execute(select(DutySchedule.member_id).where(
            DutySchedule.org_id == org.id, DutySchedule.school_year_id == sy.id,
            DutySchedule.weekday == today.weekday()))).scalars().all())
        filed = set((await session.execute(select(AttendanceDay.member_id).where(
            AttendanceDay.org_id == org.id, AttendanceDay.day == today))).scalars().all())
        for uid in roster - filed:
            ref = f"duty:{org.id}:{uid}:{today}"
            if await _already_sent(session, uid, "duty_reminder", ref, today):
                continue
            record_notification(session, org_id=org.id, user_id=uid,
                                kind="duty_reminder",
                                payload={"ref": ref, "entity_type": "journal",
                                         "entity_id": "", "title": "On duty today"})
            await send_push(session, uid,
                            title=f"{org.name} · you're on duty",
                            body="You haven't filed today — log a journal entry or tap No tasks today.",
                            data={"entity_type": "journal", "entity_id": "",
                                  "kind": "duty_reminder"})
            await notify_duty_reminder(org_name=org.name, user_id=uid)
            sent["duty_reminder"] += 1

    # papers parked on one desk ≥ STALE_DESK_DAYS → nudge the holder (once
    # per step — the ref carries the step id, not the day)
    stale_cutoff = (datetime.now(timezone.utc).replace(tzinfo=None)
                    - timedelta(days=STALE_DESK_DAYS))
    parked = (await session.execute(
        select(DocumentSignatoryStep, Document, Organization)
        .join(Document, Document.id == DocumentSignatoryStep.document_id)
        .join(Organization, Organization.id == DocumentSignatoryStep.org_id)
        .where(DocumentSignatoryStep.status == "pending",
               DocumentSignatoryStep.created_at < stale_cutoff,
               Organization.archived_at == None))).all()  # noqa: E711
    for step, doc, org in parked:
        holder = await step_holder(session, org.id, step)
        if not holder:
            continue
        ref = f"stale:{step.id}"
        if await _ever_sent(session, holder, "desk_stale", ref):
            continue
        record_notification(session, org_id=org.id, user_id=holder,
                            kind="desk_stale",
                            payload={"ref": ref, "entity_type": "document",
                                     "entity_id": str(doc.id), "title": doc.title,
                                     "desk": step.label})
        await send_push(session, holder,
                        title=f"{org.name} · paper waiting on you",
                        body=f'"{doc.title}" has been at your desk for '
                             f"{STALE_DESK_DAYS}+ days — {step.label}'s "
                             "signature keeps it moving.",
                        data={"entity_type": "document", "entity_id": str(doc.id),
                              "kind": "desk_stale"})
        sent["desk_stale"] += 1

    await session.commit()
    return {"data": {"sent": sent, "day": str(today)}}
