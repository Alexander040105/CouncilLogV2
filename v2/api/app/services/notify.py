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
    label = "a project" if kind == "project" else "a checklist task"
    await send_email(
        to=email,
        subject=f"[CounciLog] {org_name} assigned you {label}",
        text=(
            f"You've been assigned {kind} \"{title}\" in {org_name}.\n\n"
            f"Open CounciLog to see it: {base}\n\n"
            "— CounciLog"
        ),
    )
