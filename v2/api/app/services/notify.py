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

from ..config import get_settings
from ..models import Notification, Organization, Profile

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
            start_tls=s.smtp_port == 587,
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
