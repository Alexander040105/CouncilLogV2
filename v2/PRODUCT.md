# Product

<!-- impeccable:product-schema 1 -->

## Platform

web · mobile (Expo — same API contract)

## Stack

React + Vite (web, thin client) · Expo SDK 57 + React Native (mobile, thin
client) · FastAPI (all business logic) · Supabase Postgres + Auth + Storage ·
static landing page (`landing/`) · two Vercel deployments (web, api) + EAS
for mobile builds.

## Users

Primary: **student council officers** — phone-first, on campus between
classes, filing what they did on their assigned duty day and tracking papers
moving between offices. Different class schedules mean nobody can be tracked
by clock-in/out.

Also confirmed: **org presidents** (define positions, duty schedules,
templates; need the compliance view) and **faculty advisers** (oversight,
read-all). Later audience: any student organization on campus — the same
loops with different names, checklists, and signatory chains.

## Product Purpose

CounciLog replaces paper-logbook and group-chat tracking for student orgs:
attendance proven by documented work (not timestamps), a daily photo journal
of what officers actually did, project tracking across paper-processing and
logistics, and a digital logbook for where physical documents are and which
signatory has them. Success = the CCS Council runs a full semester on it and
a second org onboards with zero code changes.

## Positioning

Attendance = documented participation. Every accountability tool assumes a
clock; councils can't clock in — officers have different class schedules and
"duty" means being reachable and doing the work that day. CounciLog makes the
*daily filing* (journal entry or an explicit "nothing to do") the attendance
record. Combined with org-defined checklists/signatory chains, that mechanism
is portable to any student org — a neighboring tool built on time-tracking or
hardcoded workflows can't truthfully copy it.

## Operating Context

- Weekday duty roster (Mon–Fri assigned members; off-day filings happen too).
- Concept papers physically routed across offices for signatures — SD office,
  SAS secretary routing, SSC president, conditional extras (RFP for
  international webinars, Sir Bennyl for CES).
- Event logistics: venue through GSD (in-person, pencil bookings lapse in
  3 days), outside events need a CHED letter 15+ days ahead via two channels,
  CES has its own checklist.
- Financial reports due to CHECK within a week of each event.
- Papers authored in Google Docs + a shared council Google Drive — CounciLog
  tracks and proves, it does not author.
- Officers log in on phones; photos are taken at the moment work happens
  (delivering a paper, setting up a venue).

## Capabilities and Constraints

- Multi-tenant from day one: `org_id` everywhere; per-org positions,
  checklist templates, signatory chains, duty schedules, contact directory —
  all data, never code. CCS is the seeded first tenant.
- Membership via invite links (instant at granted role) or join requests
  (admin-approved). Email/password AND Google OAuth.
- Photos in private Supabase Storage, signed URLs only; attendance states:
  documented / declared-no-tasks / unaccounted; off-day = extra duty.
- Confidential data on board: signature routing status, officer PII, photos
  of physical papers, financial references → RBAC, audit log, tenant
  isolation are product requirements, not add-ons.
- Undecided (tracked in spec §13): notifications beyond in-app, exact EXIF
  stripping path, rate-limit store on serverless, document PDF attachments.

## Brand Commitments

Name: **CounciLog** — binding (a pun on *silog*, the Filipino breakfast dish;
council + log). Keep it; the humor is the identity. Voice: competent,
unfussy, a bit playful — a tool officers will actually open every duty day.
CCS council logos exist in legacy assets (ccs_logo, perps_logo, aura404_logo
referenced in `legacy_code`); no formal brand guide on file. Per-org
white-label accents (name/logo/color) come later — tokens must not hardcode
CCS branding.

## Evidence on Hand

- `COUNCIL_HANDBOOK_V2.md` — complete process documentation: paper checklists,
  signatory routing, event/CHED/CES logistics, duty roster SY 2026–2027,
  who-to-ask directory. Source of all seed templates.
- `legacy_code/` — prior Flask attempt; `templates/index.html` shows intended
  IA (navbar search, sidebar Home/Projects/Members/Calendar/Files, Dailies).
- `v2/spec.md` — full technical spec incl. DDL, API inventory, threat model.
- Absent and must not be fabricated: user testimonials, metrics, press,
  existing member roster data beyond the handbook's duty table, logos/assets
  files themselves.

## Product Principles

1. **Participation over time.** A day is accounted when work is documented or
   explicitly declared empty — never when someone tapped in.
2. **Prove it with a photo.** Accountability is a picture and a sentence, not
   a status someone typed.
3. **Org-shaped, not org-coded.** Every council-ism (roster, chains,
   checklists) is tenant data; CCS is the first tenant, not the schema.
4. **Papers have custody.** A document always has a where and a who; history
   is append-only — nothing gets quietly rewritten.
5. **Phone-first duty tool.** The filing flow is measured in taps; if it
   isn't fast on a 360px screen between classes, it doesn't count.

## Accessibility & Inclusion

WCAG AA minimum: contrast, visible focus, ≥44px touch targets, no
color-only status signaling (chips carry labels + icon). Members use low- to
mid-range Android phones on campus Wi-Fi — weight and performance are
accessibility concerns here.
