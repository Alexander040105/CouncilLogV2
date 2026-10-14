# CounciLog v2 Audit

Scope: `v2/` only (legacy_code excluded). Branch: `UI/UX-improvements`.

## Baseline

| Check | Result |
|---|---|
| API pytest | 149 passed (sqlite, no services) |
| Web vitest | 36 passed |
| Web `vite build` | passed |
| Mobile `node --test` | 38 passed |
| Mobile `expo lint` | passed |
| Secrets scan | clean — no hardcoded credentials |
| Dead-code scan | no TODOs, `eval`, `dangerouslySetInnerHTML`, bare `except` |

## Findings

| ID | File/line | Severity | Finding | Proposed fix | Status |
|----|-----------|----------|---------|--------------|--------|
| A1 | api/app/security.py:88 | medium | `sub` claim is checked for presence but not UUID format; a signed token with a non-UUID sub crashes `UUID(user.id)` in deps.py → 500 instead of 401 | Validate `uuid.UUID(sub)` in `verify_token` → 401 | fixed |
| A2 | api/app/routers/tasks.py:83,92 | medium | `assignee`/`creator` query params are `str`; `uuid.UUID(value)` on a non-UUID raises ValueError → 500 | Catch ValueError → 422 BAD_PARAM ("me" sentinel preserved) | fixed |
| A3 | api/app/routers/daily.py:143,284 | medium | `photos: list[dict]` is unvalidated — `p["mime"]`/`p["byte_size"]` raise KeyError → 500 on malformed entries | Validate each photo dict's keys/types → 422 BAD_PHOTO | fixed |
| A4 | api/app/routers/daily.py:109 | medium | `entry_date` accepts future dates; `declare_no_tasks` rejects them. A future-dated entry inflates attendance compliance (`filed` counts days that haven't elapsed) | Reject `entry_date > org_today()` → 422 FUTURE_DAY, same as no-tasks | fixed |
| A5 | api/app/routers/daily.py:249 | low | PATCH document link doesn't inherit the doc's project when the entry has none — create() and the task link both do | Inherit `doc.project_id` when `e.project_id` is None | fixed |
| A6 | api/app/routers/org_structure.py:56,92 | medium | `patch_position` reuses `PositionIn` (title required) + `exclude_none` → every PATCH must resend title, and `holder`/`reports_to` can never be cleared | Optional patch fields + `exclude_unset`; explicit null clears holder/reports_to | fixed |
| A7 | api/app/routers/documents.py:132 | low | `held_by` accepts any string; non-"me" values are silently ignored (silent no-op) | 422 BAD_FILTER for unsupported values | fixed |
| A8 | api/app/routers/orgs.py:253,267 | low | Invite `uses >= max_uses` check-then-increment is racy — concurrent redeems can overshoot the cap | Atomic `UPDATE … SET uses=uses+1 WHERE uses < max_uses`, 410 on no row | fixed |
| A9 | api/app/routers/orgs.py:138; admin.py:44 | low | Pagination totals fetch every row then `len()` | `func.count()` queries | fixed |
| A10 | api/app/services/../routers/internal.py:32 | low | `_ever_sent` loads every notification a user has ever received for a kind, then filters `payload.ref` in Python — grows unbounded | Filter on `payload.ref` in SQL (JSONB `->>` on postgres; bound query) | fixed |
| A11 | api/app/routers/daily.py:61; storage.py:18 | low | Journal photo signer allows `application/pdf` — a PDF "photo" can't render in the feed's image strip | Restrict `sign_photo` to image MIMEs; fix "Image must be ≤ 5MB" copy → "File" | fixed |
| A12 | api/app/routers/projects.py:382 | needs decision | Checklist-item `done` requires officer+; a member-role assignee can't tick their own item (tasks allow assignees to flip status). "Needs you" items assigned to members can't be closed by them | If intended, document it; if not, let assignees toggle `done` like tasks | needs decision |
| A13 | web/playwright.config.js, e2e/* | needs decision | 4 Playwright specs (shell/journal/mobile-viewport/console-clean) exist but never run in CI — they need a live API + real Supabase dev users | Keep as documented manual suite, or seed a CI job with test env | needs decision |
| A14 | api/app/routers/projects.py:332; orgs.py:210; finance.py:129,307; internal sweep | low | Several list endpoints cap at 500 with no cursor/truncation marker | Consistent with codebase convention; noted, no change | wontfix (documented) |

## Re-audit of fixes

After Phase 3, each fix was re-checked against the surrounding code paths
and covered by new tests (see individual commits on this branch). No new
findings were introduced by the fixes themselves.
