# SWE-2 Max Prompt — CouncilLog Refactor Spec

> Paste this entire file into a SWE-2 Max agent session opened at the repo root
> (`CouncilLogV2/`). It instructs the agent to produce `v2/spec.md`,
> `v2/PRODUCT.md`, and `v2/DESIGN.md`. No application code yet.

---

## 1. Mission

You are SWE-2 Max, a senior software engineer and system designer. Your job in
this session is **specification only — do not write application code**.

Read these source materials first:

- `COUNCIL_HANDBOOK_V2.md` — the domain bible: how the CCS student council
  actually processes papers, routes signatures, runs events, and schedules duty.
- `legacy_code/` — the previous attempt (a Flask skeleton). It contains almost
  no working logic; treat it as an **intent and information-architecture
  reference only**, not code to port. Note `legacy_code/CounciLog/templates/
  index.html` for the originally intended UI layout.

Then produce exactly three files:

| Output | Purpose |
|---|---|
| `v2/spec.md` | Complete product + technical specification for the rebuild |
| `v2/PRODUCT.md` | Durable product context (audience, goals, modes, brand direction) |
| `v2/DESIGN.md` | Design system direction (tokens, primitives, layout principles) |

---

## 2. Product framing

**CouncilLog** is a multi-tenant operations platform for student
organizations. The **CCS Council (SY 2026–2027)** is the first tenant, but the
system must be designed so that any department or student org on campus can:

- create their own organization,
- define their own officer positions and org chart per school year,
- configure their own checklists, signatory chains, and duty schedules,
- and run the same core loops: attendance, daily journaling, project tracking,
  and document/paper tracking.

CCS-specific processes (concept paper checklists, signatory routing, CHED/CES
rules, duty roster) are **seed data and templates**, never hardcoded logic.
Other orgs may share some processes but will differ — configurability is the
whole point of the SaaS.

---

## 3. Tech stack mandate

| Layer | Technology | Rule |
|---|---|---|
| Web client | React + TypeScript + Vite (`v2/web`) | **Thin client. Zero business logic in React.** |
| Backend API | FastAPI (`v2/api`) | Owns ALL business logic, authz, workflow rules |
| Database | Supabase Postgres | Row-Level Security on every org-scoped table |
| Auth | Supabase Auth | Email/password AND Google OAuth |
| File storage | Supabase Storage | Private buckets, org-scoped paths, signed URLs |
| Mobile (future) | React Native / Expo | Later phase; consumes the same FastAPI contract |
| Deployment | Vercel free tier ×2 | Separate deployments: static web + FastAPI serverless |

**DB access model (locked):** FastAPI holds the Supabase **service-role key**
and performs all authorization in application code — every endpoint resolves
the caller's org membership + role via a single `authorize()` dependency.
Postgres RLS is still enabled on every org-scoped table as **defense-in-depth**
(deny-by-default policies for non-service access paths), but the service key is
the crown jewel: server-side env only, never in the client bundle.

Non-negotiables:

- React never talks to Postgres directly and never contains workflow rules.
  All data access flows through FastAPI.
- FastAPI verifies Supabase-issued JWTs on every request and resolves the
  caller's org membership + role server-side.
- The API contract must be mobile-ready from day one (versioned REST, OpenAPI
  docs, no web-only assumptions).
- Design for Vercel serverless limits (10s function cap, no websockets, cold
  starts): photo bytes go **directly to Storage via signed URLs**, never
  through API functions.

---

## 4. Required `spec.md` sections

`v2/spec.md` must contain every section below, in this order. Treat this as a
completeness checklist — a section missing = spec rejected.

1. **Overview & goals** — problem statement, target users, success criteria.
2. **Personas & roles** — e.g., org creator/president, adviser, officer,
   regular member, and how roles map to permissions per org.
3. **Feature specifications** — the six systems in Section 5, each with user
   stories, behavior details, and edge cases.
4. **Data model** — **real PostgreSQL DDL** (`CREATE TABLE` statements with
   columns, types, constraints, FKs, indexes) **plus RLS policy SQL** for every
   table. `org_id` on every org-scoped table. Include the audit log table(s)
   and the RLS helper functions. DDL must be liftable into Supabase migrations.
5. **API specification** — FastAPI endpoint inventory (method, path, request/
   response shape, required role). REST, versioned (`/api/v1/...`), OpenAPI.
6. **Screen/route inventory** — the web app's pages mapped to user flows.
   Evolve the legacy IA (Home, Projects, Members, Calendar, Files, Dailies —
   see `legacy_code/CounciLog/templates/index.html`) rather than copying it.
7. **Configurable workflow design** — how org-defined checklist templates,
   signatory chains, and duty schedules are modeled as data and executed.
8. **Security & privacy + threat model** — everything in Section 6.
9. **Seed data plan** — which CCS handbook knowledge ships as starter
   templates/seed rows vs. what stays org-entered.
10. **Non-functional requirements** — mobile-responsive web, Asia/Manila
    timezone handling, photo size/type limits, performance expectations,
    auditability.
11. **Phased roadmap** — ordered build phases ending with React Native.
12. **Acceptance criteria** — per feature, testable statements.
13. **Open questions** — anything ambiguous; list, don't silently assume.

---

## 5. Feature requirements to spec

### 5.1 Auth & org onboarding

- Supabase Auth with **email/password and Google OAuth**, available to both
  org creators and regular members.
- **Create-organization flow**: a user can found an org, becomes its first
  admin/president, names it, and gets an empty org workspace.
- **Membership**: invite links/codes issued by org admins; also a join-request
  flow where an admin approves or rejects. No open self-join.
- **Org chart / positions**: each org defines its own positions (e.g.,
  President, VP, Secretary, PRO...) **per school year**, with history preserved
  across years. The president (or designated admin) assigns members to
  positions. Org chart view required.

### 5.2 Attendance — participation-based

- Attendance is **documented participation, not clock time**. Check-in/out
  timestamps are explicitly *not* the core mechanic — officers have different
  class schedules and can't be tracked by time.
- Each member files a **daily entry** on the webapp: either
  (a) journal entries describing what they did (with photo proof — see 5.3),
  or (b) an explicit **"no tasks today"** declaration. A day with neither is an
  unaccounted day.
- Each org configures a **duty schedule** (which members are expected on which
  weekdays — CCS's Mon–Fri roster is seed data). Entries on a member's
  scheduled day = "duty"; entries on off-days are allowed and flagged
  "extra duty" — never blocked.
- Views: attendance by day, by week, by member; duty-compliance summary per
  officer.

### 5.3 Daily Journal

- Officers document work by **uploading a photo + writing a description** of
  what they did that day ("Daily Journal" feed).
- Entries can be tagged to tasks/projects. Multiple entries per day allowed.
- Journal entries satisfy the attendance requirement for that day.
- Photos go to Supabase Storage under org-scoped paths; served through signed
  URLs only (see security section).

### 5.4 Projects tracker

- Track upcoming events/projects needing **paper processing** and/or
  **logistics processing**: title, description/details, target date, owner,
  status, and which processing tracks apply.
- Each project gets **checklists generated from org templates** — e.g., CCS's
  concept-paper checklist, outside-event CHED checklist, CES checklist, and
  event logistics checklist (all derivable from `COUNCIL_HANDBOOK_V2.md`).
- Status and checklist progress visible at a glance; deadlines (like the
  15-day CHED rule or 1-week financial report rule) live in template config.

### 5.5 Paper logbook (document tracking)

- A **digital logbook for physical documents**: where a paper currently is
  (e.g., "at the SD office"), who last moved it, when, plus **photo evidence**
  of handoff/location.
- Full movement history per document — append-only, never rewritten.
- Documents follow **signatory chains** (e.g., concept paper → SSC President →
  SAS → School Director, with conditional extra signatories like RFP for
  international webinars or Sir Bennyl for CES). Chains are workflow template
  data, and the logbook shows which step a paper is on.
- Scope note: signatory tracking here is **status/metadata** (who needs to
  sign, where the paper physically is, who marked a step done) — not digital
  signature-image capture. If signature images or scanned documents are ever
  uploaded, they inherit the sensitive-data classification in Section 6.

### 5.6 SaaS configurability

- Everything org-specific is **data, not code**: positions, checklist
  templates, signatory/workflow chains, duty schedules.
- Org admins can edit their own templates without touching other orgs.
- CCS ships as **seed templates** so the first tenant works out of the box —
  and so the seeding mechanism itself is proven for tenant #2+.

---

## 6. Security & privacy requirements (dedicated spec section)

The app handles **confidential transactions and sensitive information** —
signature routing status, officer PII, photos of physical documents, financial
references. The spec's Security & Privacy section must open with a threat
model, then cover all of:

0. **Threat model (STRIDE)** — name the trust boundaries (client↔API,
   API↔Supabase/service key, file uploads, invite/join links, OAuth callback)
   and the assets (service key, signature-step status, document photos, member
   PII, financial references). Run STRIDE over each boundary in a compact
   table; every threat maps to a named control.
1. **RBAC** — a per-org permission model (e.g., president > adviser > officer
   > member) enforced at the FastAPI endpoint level through **one shared
   `authorize()` dependency** — no endpoint ships without it. Define a
   permission matrix: which roles can view/edit signature-step status,
   financial references, member info, org settings, templates.
2. **Tenant isolation** — app-level org scoping on every query (service key +
   `authorize()`) AND Postgres RLS deny-by-default on every org-scoped table
   as defense-in-depth. Storage objects isolated per org path. Include an
   explicit acceptance criterion: automated test proving org A cannot read or
   write org B's data via API or storage.
3. **Sensitive data handling** — classify sensitive fields (signature-chain
   status, document/journal photos, member emails/names, financial figures).
   All storage buckets private — **no public URLs**. Photos/documents served
   only via short-lived signed URLs (TTL ≤ 15 min) minted by FastAPI after
   authorization. No sensitive data in logs, error messages, or analytics.
4. **Transport & session security** — HTTPS only; **decide and justify** the
   session model: Authorization-header Bearer JWT vs httpOnly cookie — weigh
   the split-origin Vercel deployment (cookie `SameSite=None;Secure` + CSRF
   token cost) against the localStorage/XSS tradeoff of Bearer tokens, and
   state mitigations for whichever is chosen. CORS allowlist = the web
   deployment origin only; no wildcard.
5. **Audit trail** — append-only, org-scoped audit log for sensitive actions:
   document movements, signature-step changes, role/position assignments,
   org setting/template edits, and post-hoc edits to attendance/journal
   entries after the day closes.
6. **Upload safety** — validate file type/size on upload (allowlist
   jpeg/png/webp, size cap, magic-byte verification — never trust the
   extension); strip EXIF metadata (photos can leak GPS location); reject
   non-image content; org-scoped private paths.
7. **Data lifecycle** — retention policy: what happens to journals, photos,
   and document logs when a school year ends or an org offboards;
   soft-delete vs hard-delete rules.
8. **Secrets & config** — all credentials via env vars / secret manager;
   `.env.example` committed, real `.env` gitignored; service-role key
   server-side only. Source documents contain real credentials (handbook §1)
   — they must NOT appear in the spec, schema, seed data, examples, or code.
9. **Input validation & query safety** — Pydantic schemas validate every
   request body/query at the endpoint boundary; database access exclusively
   through parameterized queries / SQLModel-SQLAlchemy (never string-built
   SQL); consistent error envelope `{error:{code,message,details?}}` with no
   stack traces or internals exposed to clients.
10. **Platform hardening** — security headers on the web deployment (CSP,
    HSTS, X-Frame-Options, X-Content-Type-Options); rate limiting on
    auth-adjacent and minting endpoints (join requests, invites, signed-URL
    issuance) — spec names the limits and a serverless-viable mechanism or
    flags it as an open question; dependency hygiene: pinned lockfiles both
    sides, `pip-audit`/`npm audit` triage in a later phase.

---

## 7. Constraints & rules for your output

- **No secrets ever.** Do not copy the Gmail password or any credential from
  `COUNCIL_HANDBOOK_V2.md` into any artifact. (Separately: flag to the user
  that this password is committed in the repo and should be rotated.)
- **No hardcoded CCS data in the architecture.** Names from the duty schedule,
  signatory list, etc. appear only as seed/template data proposals.
- **API-first.** Every web feature must be reachable through the documented
  FastAPI contract so React Native can reuse it later.
- **Don't modify source files.** `legacy_code/` and `COUNCIL_HANDBOOK_V2.md`
  are read-only inputs.
- **Ambiguity → open questions.** If a requirement is unclear, add it to the
  Open Questions section instead of guessing silently.
- Prefer **source-grounded decisions**: when you make a non-obvious technical
  choice, cite the official docs' guidance in one line.

---

## 8. `v2/PRODUCT.md` brief

Write the durable product context (use the impeccable `product-schema 1`
format — `# Product` with `<!-- impeccable:product-schema 1 -->` and its
section headings verbatim):

- **What it is:** multi-tenant ops platform for student organizations —
  attendance through documented participation, daily photo journals, project &
  paperwork tracking, physical-document logbook.
- **Name:** **CounciLog** — the product name is binding (a pun on *silog*,
  the Filipino dish). Orgs white-label their own workspace inside it.
- **Audience:** student officers, org presidents, faculty advisers; later,
  any student org on campus.
- **Design mode:** *Operate* — this is a task-completion tool. Scanability,
  consistency, and speed outrank decoration. Brand lives in precise details.
- **Tone:** competent, trustworthy, low-friction; feels like a tool officers
  will actually open every duty day.
- **White-label readiness:** per-org name/logo/color accents eventually;
  design tokens must not hardcode CCS branding.
- **Non-goals:** not a social network, not a public-facing site, not a
  document editor (papers are still made in Google Docs — we track them).

## 9. `v2/DESIGN.md` brief

Write the design-system direction:

- **Tokens:** color palette (accessible, works in light mode; dark mode
  optional phase), type scale, spacing scale, radii, elevation.
- **Primitives:** buttons, inputs, cards, tables/lists, badges/status chips
  (for signature-step and checklist states), photo thumbnails, empty states.
- **Key UX surfaces to design for:**
  - daily entry flow (photo + description, or "no tasks" declaration) —
    must be fast on mobile web,
  - journal feed (photo-centric),
  - project detail with paper/logistics checklists,
  - paper logbook timeline (movement history),
  - org chart per school year,
  - admin template editors (positions, checklists, signatory chains,
    duty schedule).
- **Mobile-first responsive** — officers will mostly use phones on campus;
  the layout must work at 360px width before desktop.
- **Accessibility:** WCAG AA minimum — contrast, focus states, touch targets.

---

## 10. Acceptance criteria for your output

Before finishing, verify:

- [ ] `v2/spec.md` contains all 13 required sections from Section 4.
- [ ] The data model is **real DDL + RLS policy SQL**, and satisfies every
      feature in Section 5 — trace each one.
- [ ] `org_id` + RLS appears on every org-scoped table.
- [ ] Security section covers all items in Section 6, **including the STRIDE
      threat model table**, a **decided session model with justification**,
      and the cross-org isolation test criterion.
- [ ] Every endpoint in the API inventory names its required role and flows
      through the shared authorization dependency.
- [ ] Attendance spec reflects participation-based semantics (no time-clock
      mechanics; off-day logging allowed; "no tasks" is a first-class state).
- [ ] CCS handbook knowledge appears only as seed templates — verify no
      names/rules are baked into schema constraints or API logic.
- [ ] No credentials or secrets anywhere in the three output files.
- [ ] `v2/PRODUCT.md` and `v2/DESIGN.md` exist and follow Sections 8–9.
- [ ] Every ambiguity is in Open Questions — nothing silently assumed.
