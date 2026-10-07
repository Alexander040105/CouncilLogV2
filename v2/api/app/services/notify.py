"""Assignment notification emails via SMTP (Maileroo).

Looks up the assignee's email through the Supabase auth admin API using the
service-role key — `profiles` deliberately doesn't store emails. Sending is a
no-op when SMTP isn't configured, so dev/test environments stay quiet.

Set in .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM.
"""

import logging
import uuid
from email.message import EmailMessage

import aiosmtplib
import httpx

from sqlmodel import func, select

from ..config import get_settings
from ..models import (Notification, Organization, Position, Profile,
                      SchoolYear)

log = logging.getLogger("councilog.notify")


async def member_email(user_id: uuid.UUID | str) -> str | None:
    """Resolve a user's email via the Supabase auth admin API (service role)."""
    s = get_settings()
    if not s.supabase_service_role_key or "placeholder" in s.supabase_service_role_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"{s.supabase_url}/auth/v1/admin/users/{user_id}",
                headers={"Authorization": f"Bearer {s.supabase_service_role_key}",
                         "apikey": s.supabase_service_role_key},
            )
        return r.json().get("email") if r.status_code == 200 else None
    except Exception:
        log.exception("email lookup failed for %s", user_id)
        return None


async def send_email(to: str, subject: str, text: str) -> bool:
    """Send a plain-text email via SMTP. No-op (returns False) if unconfigured."""
    s = get_settings()
    if not (s.smtp_user and s.smtp_password and s.mail_from):
        log.info("smtp not configured — skipped email to %s: %s", to, subject)
        return False
    msg = EmailMessage()
    msg["From"] = s.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    try:
        await aiosmtplib.send(
            msg, hostname=s.smtp_host, port=s.smtp_port,
            username=s.smtp_user, password=s.smtp_password,
            start_tls=s.smtp_port == 587, timeout=15,
        )
        return True
    except Exception:
        log.exception("smtp send failed to %s", to)
        return False


async def notify_assignment(*, org_name: str, kind: str, title: str,
                            assignee_id: uuid.UUID | str) -> None:
    """Email a member that a project or checklist item was assigned to them."""
    email = await member_email(assignee_id)
    if not email:
        log.info("no email for user %s — skipped notification", assignee_id)
        return
    base = get_settings().app_base_url.rstrip("/")
    label = {"project": "a project", "checklist_item": "a checklist task",
             "task": "a task"}.get(kind, "an item")
    await send_email(
        to=email,
        subject=f"[CounciLog] {org_name} assigned you {label}",
        text=(
            f"You've been assigned {label} \"{title}\" in {org_name}.\n\n"
            f"Open CounciLog to see it: {base}\n\n"
            "— CounciLog"
        ),
    )


# ── In-app inbox + push fan-out ─────────────────────────────────────────
KIND_LABELS = {"project": "a project", "checklist_item": "a checklist task",
               "task": "a task"}


def record_notification(session, *, org_id, user_id, kind: str,
                        payload: dict | None = None) -> Notification:
    """Insert an inbox row inside the caller's transaction — an assignment
    and its notification commit together or not at all."""
    n = Notification(org_id=org_id, user_id=uuid.UUID(str(user_id)),
                     kind=kind, payload=payload or {})
    session.add(n)
    return n


async def push_to_user(user_id, *, title: str, body: str,
                       data: dict | None = None) -> None:
    """Background-task entry point: push needs its own session — the
    request's session is closed by the time BackgroundTasks run."""
    from ..db import SessionLocal
    from .push import send_push
    async with SessionLocal() as s:
        await send_push(s, user_id, title=title, body=body, data=data)
        await s.commit()   # persists dead-token pruning from the receipts


async def fan_out_assignment(session, bg, *, org_id, actor_id: str, kind: str,
                             title: str, assignee_id, entity_type: str,
                             entity_id) -> None:
    """One assignment → inbox row (in-transaction) + email + push (background).

    Call BEFORE session.commit() so the notification row rides the request's
    transaction; delivery channels degrade independently after that."""
    if not assignee_id or str(assignee_id) == actor_id:
        return
    org = await session.get(Organization, org_id)
    org_name = org.name if org else "your org"
    actor = await session.get(Profile, uuid.UUID(actor_id))
    by = actor.display_name if actor else "someone"
    label = KIND_LABELS.get(kind, "an item")
    record_notification(
        session, org_id=org_id, user_id=assignee_id, kind="assigned",
        payload={"entity_type": entity_type, "entity_id": str(entity_id),
                 "title": title, "by": by})
    bg.add_task(notify_assignment, org_name=org_name, kind=kind, title=title,
                assignee_id=assignee_id)
    bg.add_task(push_to_user, assignee_id,
                title=f"{org_name} · {by} assigned you {label}",
                body=title,
                data={"entity_type": entity_type, "entity_id": str(entity_id),
                      "kind": "assigned"})


# ── Reminder emails (cron-driven; see routers/internal.py) ──────────────
async def notify_task_due_soon(*, org_name: str, title: str,
                               user_id: uuid.UUID | str) -> None:
    email = await member_email(user_id)
    if email:
        await send_email(
            to=email,
            subject=f"[CounciLog] \"{title}\" is due tomorrow",
            text=(f"Your task \"{title}\" in {org_name} is due tomorrow.\n\n"
                  "— CounciLog"))


async def notify_duty_reminder(*, org_name: str,
                               user_id: uuid.UUID | str) -> None:
    email = await member_email(user_id)
    if email:
        await send_email(
            to=email,
            subject=f"[CounciLog] You're on duty today in {org_name}",
            text=(f"You're on today's duty roster in {org_name} and haven't "
                  "filed yet — log a journal entry or tap \"No tasks today\".\n\n"
                  "— CounciLog"))


# ── Paper + people + progress fan-outs ────────────────────────────────
# Same contract as fan_out_assignment: record_notification rides the
# caller's transaction; push goes out on BackgroundTasks. These are
# push+inbox only — no email; papers and joins would spam inboxes.

def _notify(session, bg, *, org_id, user_id, kind: str, entity_type: str,
            entity_id, payload_extra: dict, push_title: str,
            push_body: str) -> None:
    record_notification(
        session, org_id=org_id, user_id=user_id, kind=kind,
        payload={"entity_type": entity_type,
                 "entity_id": str(entity_id) if entity_id else "",
                 **payload_extra})
    bg.add_task(push_to_user, user_id, title=push_title, body=push_body,
                data={"entity_type": entity_type,
                      "entity_id": str(entity_id) if entity_id else "",
                      "kind": kind})


async def step_holder(session, org_id, step) -> uuid.UUID | None:
    """Resolve a signatory step's desk to the member holding that position
    in the org's current school year. None when the seat is vacant — a
    paper on an empty desk stays silent (the doc UI shows it waiting)."""
    title = (step.office or step.label or "").strip()
    if not title:
        return None
    sy = (await session.execute(select(SchoolYear).where(
        SchoolYear.org_id == org_id, SchoolYear.is_current == True))  # noqa: E712
    ).scalars().first()
    if sy is None:
        return None
    pos = (await session.execute(select(Position).where(
        Position.org_id == org_id, Position.school_year_id == sy.id,
        func.lower(Position.title) == title.lower()))).scalars().first()
    return pos.holder if pos else None


async def fan_out_desk(session, bg, *, org_id, actor_id: str, doc, step) -> None:
    """A paper just landed on `step`'s desk — ping its position holder.
    `actor_id` is skipped so you never ping yourself."""
    holder = await step_holder(session, org_id, step)
    if not holder or str(holder) == str(actor_id):
        return
    org = await session.get(Organization, org_id)
    _notify(
        session, bg, org_id=org_id, user_id=holder, kind="sign_needed",
        entity_type="document", entity_id=doc.id,
        payload_extra={"title": doc.title, "desk": step.label},
        push_title=f"{org.name if org else 'CounciLog'} · a paper is at your desk",
        push_body=f'"{doc.title}" is waiting for the {step.label}\'s signature')


async def fan_out_sent_back(session, bg, *, org_id, actor_id: str, doc,
                            back_to_step=None, note: str | None = None) -> None:
    """Paper was sent back for revision — tell the mover, plus the holder
    of the desk it bounced back to (who must re-sign)."""
    org = await session.get(Organization, org_id)
    org_name = org.name if org else "CounciLog"
    why = f" — {note}" if note else ""
    for uid, body in [
        (doc.created_by, f'"{doc.title}" was sent back for revision{why}'),
        (await step_holder(session, org_id, back_to_step) if back_to_step else None,
         f'"{doc.title}" is back at your desk for another look{why}'),
    ]:
        if not uid or str(uid) == str(actor_id):
            continue
        _notify(
            session, bg, org_id=org_id, user_id=uid, kind="sent_back",
            entity_type="document", entity_id=doc.id,
            payload_extra={"title": doc.title, "note": note},
            push_title=f"{org_name} · paper sent back", push_body=body)


async def fan_out_doc_signed(session, bg, *, org_id, actor_id: str, doc) -> None:
    """Every step in the round signed — the mover should know it's ready
    to file."""
    if not doc.created_by or str(doc.created_by) == str(actor_id):
        return
    org = await session.get(Organization, org_id)
    _notify(
        session, bg, org_id=org_id, user_id=doc.created_by, kind="doc_signed",
        entity_type="document", entity_id=doc.id,
        payload_extra={"title": doc.title},
        push_title=f"{org.name if org else 'CounciLog'} · paper fully signed",
        push_body=f'"{doc.title}" collected every signature — ready to file')


async def fan_out_progress(session, bg, *, org_id, actor_id: str, kind: str,
                           user_id, entity_type: str, entity_id,
                           title: str, push_body: str,
                           payload_extra: dict | None = None) -> None:
    """Progress pings: task marked done → creator, project status change →
    lead. Caller passes the recipient; actor is skipped."""
    if not user_id or str(user_id) == str(actor_id):
        return
    org = await session.get(Organization, org_id)
    _notify(
        session, bg, org_id=org_id, user_id=user_id, kind=kind,
        entity_type=entity_type, entity_id=entity_id,
        payload_extra={"title": title, **(payload_extra or {})},
        push_title=f"{org.name if org else 'CounciLog'} · progress",
        push_body=push_body)


async def fan_out_join_request(session, bg, *, org_id, requester_id: str,
                               requester_name: str) -> None:
    """Someone asked to join — every active owner gets the ping (they're
    the only role that can decide)."""
    from ..models import OrgMember
    owners = (await session.execute(select(OrgMember.user_id).where(
        OrgMember.org_id == org_id, OrgMember.role == "owner",
        OrgMember.status == "active"))).scalars().all()
    org = await session.get(Organization, org_id)
    org_name = org.name if org else "CounciLog"
    for uid in owners:
        if str(uid) == str(requester_id):
            continue
        _notify(
            session, bg, org_id=org_id, user_id=uid, kind="join_request",
            entity_type="member", entity_id="",
            payload_extra={"title": f"{requester_name} wants to join",
                           "name": requester_name},
            push_title=f"{org_name} · join request",
            push_body=f"{requester_name} wants to join {org_name}")


async def fan_out_join_decided(session, bg, *, org_id, user_id, actor_id: str,
                               approved: bool) -> None:
    """The requester hears the verdict."""
    if str(user_id) == str(actor_id):
        return
    org = await session.get(Organization, org_id)
    org_name = org.name if org else "CounciLog"
    _notify(
        session, bg, org_id=org_id, user_id=user_id, kind="join_decided",
        entity_type="org", entity_id=org_id,
        payload_extra={"title": "approved" if approved else "declined",
                       "approved": approved},
        push_title=f"{org_name} · join request {'approved' if approved else 'declined'}",
        push_body=(f"You're in — welcome to {org_name}." if approved
                   else f"Your request to join {org_name} was declined."))
