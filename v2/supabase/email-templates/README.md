# CounciLog auth email templates

Neo-brutalist HTML templates for Supabase auth emails — same visual system as
the app (white card on `#f2f0ea`, 3px black borders, hard offset shadows, amber
`#f4be04` CTAs, navy `#27146e` headings). Table layout + inline styles, so they
survive Gmail, Apple Mail, and Outlook (Outlook drops `box-shadow` — the
borders carry the look anyway).

## How to install

Supabase → **Authentication → Emails** (or **Auth → Email Templates**). For each
row: open it, paste the matching file's HTML into the body, set the subject,
save. Subjects suggested below.

| Dashboard slot | File | Suggested subject |
|---|---|---|
| Confirm sign up | `confirm-signup.html` | `Confirm your CounciLog email` |
| Invite user | `invite-user.html` | `You're invited to CounciLog` |
| Magic link or OTP | `magic-link.html` | `Your CounciLog sign-in link` |
| Change email address | `change-email.html` | `Confirm your new CounciLog email` |
| Reset password | `reset-password.html` | `Reset your CounciLog password` |
| Reauthentication | `reauthentication.html` | `Your CounciLog verification code` |
| Password changed | `security-password-changed.html` | `Your CounciLog password was changed` |
| Email address changed | `security-email-changed.html` | `Your CounciLog sign-in email was changed` |
| Phone number changed | `security-phone-changed.html` | `Your CounciLog phone number was changed` |
| Sign-in method linked | `security-signin-linked.html` | `New sign-in method on your CounciLog account` |
| Sign-in method removed | `security-signin-removed.html` | `A sign-in method was removed from CounciLog` |
| MFA method added | `security-mfa-added.html` | `New verification step on your CounciLog account` |
| MFA method removed | `security-mfa-removed.html` | `A verification step was removed from CounciLog` |

The security rows only send if their toggles are on — keep them on; they're the
account-takeover tripwire.

## Variables used (Supabase Go templates)

- `{{ .ConfirmationURL }}` — action link (confirm/invite/magic/recovery/email-change)
- `{{ .Token }}` — OTP code fallback for the same flows
- `{{ .Email }}`, `{{ .NewEmail }}` — account / new address
- `{{ .Provider }}` — sign-in linked/removed only
- `{{ .FactorType }}` — MFA added/removed only
- `{{ .SiteURL }}` — footer link (Auth → URL Configuration → Site URL)

Don't use a variable outside the templates that support it — unsupported slots
render `<no value>`.

## Editing rules

- Inline styles only — no `<style>` blocks (Gmail strips them).
- Keep everything inside the `<table>` skeleton — no flex/grid/divs for layout.
- Palette: white `#ffffff` · navy `#27146e` · amber `#f4be04` (fill + black
  text only) · black `#000000` strokes · bone `#f2f0ea` page bg · red `#b91c1c`
  only for "wasn't you?" warnings.
- Every email must answer "why am I getting this?" in the footer and "what do I
  do now?" in the body — per AGENTS.md copy rules.
