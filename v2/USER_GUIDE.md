# CounciLog User Guide — CCS Council

How to run the council's real processes in CounciLog. This maps the handbook
(`../COUNCIL_HANDBOOK_V2.md`) onto the app — read this once as owner, then point
officers at the playbook they need.

- **Part A — playbooks:** do things the way the council actually works
- **Part B — feature reference:** what every page does and who can use it

---

## Part A — Playbooks

### A0. Roles at a glance

| Role | Can do | Give it to |
|---|---|---|
| **owner** | Everything: members, invites, positions, duty schedule, templates, chains, contacts, audit | Whoever creates the org (set at creation, can't be reassigned in the UI) |
| **adviser** | Creates/edits projects, generates checklists, views audit log — plus everything below | Council adviser(s) |
| **officer** | Journal entries, checks off checklist items, registers papers, logs movements, signs/skips signatory steps | Working officers |
| **member** | Journal entries + own attendance, read access | Everyone else |

People join two ways (both on the "Get started" screen after sign-up):

- **Invite code** — owner mints one in **Settings → invites** at a chosen role;
  redeeming joins instantly *at that role*. Single-use, expires in 7 days.
  Officer/adviser codes are capability grants — share them carefully.
- **Join request** — the person pastes the **Organization ID** (owner copies it
  from the card at the top of **Settings**); owner approves *with a role* or
  rejects in **Settings → invites → Pending join requests**.

### A1. Day 1 — set up the council (owner)

Do these in order — later steps need the earlier ones populated.

1. **Create the org.** Sign up → "Start your organization" → name `CCS Council`,
   slug `ccs-council`, school year `SY 2026–2027`. You become owner automatically.
2. **Get officers in.** Settings → invites → pick `officer` → Mint invite → send
   each code. Repeat with `adviser` for the adviser. (Everyone else can use the
   org-ID join-request path once it's moving.)
3. **Positions.** Settings → positions → add each office for the current school
   year (title + holder). This builds the org chart on the Members page.
4. **Duty schedule.** Settings → duty → tick the weekday(s) each member covers —
   the handbook roster, mapped to accounts as people join:

   | Day | Members |
   |---|---|
   | Mon | James, Dig, Coloma, Andaya, Erich |
   | Tue | Weiam, Kristine, Sophia, AJ, De Dios |
   | Wed | Maricar, Bill, Trisha, Jade, Tel, Lhesley |
   | Thu | Ang, Virata, AJ, Sam |
   | Fri | Bella, Marvin, Daphne, Raph, Lindsay |

   Filing on an off-day counts as **extra duty** — you don't need to schedule it.
5. **Checklist templates.** Settings → templates → create each of these (items
   go in the "one per line" box). These come straight from the handbook:

   **"Concept Paper Pack"** — track `paper` (handbook §3 sign-off checklist):
   ```
   Summary letter
   Board resolution
   Concept paper (new format — template on the Drive)
   Speaker's CV
   Speaker's certificates
   Justification letter for outside supplier (when buying outside the canteen)
   ```

   **"Event Logistics"** — track `logistics` (handbook §10):
   ```
   Assign event-day committees (Registration & Evaluation, Documentation, Technical, Emcees, Logistics)
   Tarpaulin — especially for onsite seminars/events
   Food for committees, faculty, and speaker (seminars)
   Food for participants too (competitions / outside events)
   Venue — GSD in person, Zoom link via ITS, or IoT Lab via Engineering Dept
   Sound system + microphone from CCS Office (if venue is a computer lab)
   Transport — van request via GSD; bus via AR Travel for educ tours
   Registration forms accomplished (competitions)
   Certificates — participants, and the guest speaker (seminars)
   Pubmats — poster for Facebook + invitation for the faculty
   ```

   **"Outside Event Pack"** — track `logistics` (handbook §12):
   ```
   CHED letter (CMO 63 s. 2017 format) — submit ≥15 days before, target 1 month; hard copy + email BOTH
   Participant list + parents' consent for each
   Curriculum forms — one per course (IT and CS), relevant subjects highlighted
   Medical checkup letter — Ma'am Vincoy signs; schedule the clinic checkup
   Van/bus request — form from the GSD
   ```

   **"Financial Report"** — track `paper` (handbook §7):
   ```
   Prepare the financial report (sample forms on the Drive)
   Submit to CHECK within 1 week after the event
   Confirm whether CHECK is also a signatory on this report
   ```

6. **Signatory chains.** Settings → chains → create one chain per document
   type. When a paper is registered, the chain matching its `doc_type` is
   attached automatically. Steps go one per line, in signing order:

   **"Standard Concept Paper"** — doc type `concept_paper` (handbook §4):
   ```
   SSC President — 2nd floor hallway, office on the left
   SAS — Ma'am Ana, 2nd floor hallway end (routes to Ma'am Vincoy)
   School Director — 2nd floor corner office
   ```

   **"Board Resolution"** — doc type `board_resolution` (handbook §5 — same
   signatories minus the SSC President):
   ```
   SAS — Ma'am Ana, 2nd floor hallway end
   School Director — 2nd floor corner office
   ```

   **"CES Concept Paper"** — doc type `ces_concept_paper` (handbook §13):
   ```
   SSC President — 2nd floor hallway, office on the left
   SAS — Ma'am Ana, 2nd floor hallway end
   Sir Bennyl — 2nd floor right side, across kids' library (bring previous CES activity reports)
   School Director — 2nd floor corner office
   ```

7. **Contacts.** Settings → contacts → add the who-to-ask directory (handbook
   §15). Label = the need, value = who/where. Suggested set:
   `Templates & forms → Council Google Drive`,
   `Concept paper / activity report questions → Ate Daphne`,
   `Financial report questions → Ate Bella, Jade, or Christel`,
   `SAS routing → Ma'am Ana`,
   `SD signature → SD office, 2nd floor corner`,
   `SSC President → SSC office, 2nd floor left`,
   `Venue / van requests → GSD, in person`,
   `Gym pencil booking → Coach, varsity room`,
   `CES signatory → Sir Bennyl`,
   `CHED questions → Ma'am Ana (SAS) or SSC President Cez`,
   `CHED office email → Ma'am Lily, Registrar`,
   `Medical letter → Ma'am Vincoy`,
   `RFP / Zoom links → Ma'am Feb`,
   `Sound system & mic → CCS Office`,
   `Bus rental → AR Travel`.
8. **Done.** Officers can now work — see playbooks below. Settings → audit is
   your read-only record of who did what.

### A2. Joining the council (everyone)

1. Register → "Get started" screen.
2. **With a code:** Join with code → paste it → you're in at the role the code
   carried.
3. **Without a code:** join-request box → paste the **Organization ID** (get it
   from the owner — it's the card at the top of Settings) → optional message →
   wait for the owner to approve.

### A3. Daily duty (everyone on the roster)

There is no clock-in — **a filed day is attendance**.

- On your assigned day, either **Log work** (photo optional but encouraged —
  phone camera opens directly on mobile) or tap **No tasks today**. Either way
  you're counted.
- Filing on a day you're *not* scheduled counts as **extra duty**.
- **Today** shows your status + how many scheduled members haven't filed yet.
- **Attendance** is the weekly grid (✓ filed / ∅ no-tasks / extra) plus a
  filing-rate table per officer — this is your compliance record.
- Link entries to a **Project** when the work belongs to one (e.g., "delivered
  concept paper to SD office" → the event's project).

### A4. Running an event end-to-end

1. **Create the project** (adviser or owner): Projects → New project → title,
   details, **event type**, **target date**, and tick **Needs papers** /
   **Needs logistics** as appropriate.
   - Use a consistent `event_type` vocabulary — it drives auto-matching:
     `seminar`, `competition`, `webinar`, `webinar_intl`, `outside`, `ces`,
     `educ_tour`. A template tagged to an event type only lands on matching
     projects; untyped templates land everywhere their track matches.
   - Scheduling rule (handbook §3): never within 1 week before or during exam
     week — you have ~2-week windows.
   - **Assign a lead** with "Assign to" — defaults to you. The assignee gets an
     email (when email is configured).
2. **Generate the checklist.** Open the project → "Generate checklist". Matching
   templates snapshot into live items — paper-track items when it needs papers,
   logistics-track when it needs logistics (a `both` template lands either way).
   Editing a template later won't rewrite existing checklists — snapshots are
   frozen.
3. **Assign tasks.** Adviser+ can assign any checklist item to a member via the
   per-item dropdown — they're emailed. Officers can self-assign an unassigned
   item with "Take it".
4. **Work the checklist.** Officers tick items as they're done (officer+).
   Hints and due dates ride along when present.
4. **Track each paper** it produces — see A5.
5. **After the event:** the financial report goes to CHECK within 1 week
   (handbook §7), the activity report answers to Ate Daphne's format (§6), and
   the semester-end report bundles everything (§8).

### A5. Tracking a paper door-to-door

Papers is a **custody logbook for physical documents** — the newest movement is
where the paper physically sits.

1. **Register it** (officer+): Papers → New document → title + `doc_type`. If a
   chain matches the doc type, its steps attach automatically — you can also
   pick a chain manually. `doc_type` values to standardize on:
   `concept_paper`, `board_resolution`, `financial_report`, `activity_report`,
   `ces_concept_paper`, `letter`.
2. **Every hand-off = "Move paper"**: where it is now (e.g. "SD office",
   "with Ma'am Ana"), an optional note, and an optional photo of the
   paper/location. Movements are append-only — the log never lies.
3. **Advance the chain** (officer+): mark each step **Sign** when done, or
   **Skip** with a required reason (recorded for the next signer — e.g. "office
   closed this week").
4. **Status flow:** `drafting → routing → signed → filed`.

### A6. Handbook edge cases

- **International webinars (RFP):** the rules engine supports conditional
  signatory steps (e.g., an RFP step that only appears for `webinar_intl`) —
  but the Settings UI doesn't expose conditions yet, only plain step lists.
  *Workaround:* include the RFP step in the chain and **Skip** it with reason
  "not an international webinar" when it doesn't apply. Same trick for the
  Marketing/Bookstore step on merch activities.
- **Outside events:** instantiate the Outside Event Pack — but the letter
  still goes to CHED **two channels** (hard copy to the City Hall Compound +
  email via Ma'am Lily at the Registrar). CES activities are the only
  exemption (§12).
- **Venue pencil bookings** lapse after 3 days without a finished concept
  paper — keep "finish papers first" ordering from §9.
- **Owner transfer** can't be done in the UI — ownership is set at org
  creation; it's a deliberate operation, ask a dev if needed.

### A7. When in doubt

Settings → contacts mirrors the handbook's who-to-ask table. For anything the
app doesn't cover, the handbook is the source of truth:
`../COUNCIL_HANDBOOK_V2.md`.

---

## Part B — Feature reference

| Page | What it's for | Who can use it | Gotchas |
|---|---|---|---|
| **Today** (`/`) | Your duty status, today's roster, unaccounted-member count, quick links | everyone | "Nothing filed yet" until you log work or declare no-tasks |
| **Journal** | Photo + one-line work entries, grouped by day; optional project link | member+ | Photo optional; entries prove the duty day; own-day edits only (owner can edit any) |
| **Attendance** | Weekly filing grid + per-officer filing rate for the school year | everyone (read) | A "filed" chip needs a journal entry; ∅ = declared no tasks; extra = off-day filing |
| **Projects** | Board by status (`draft/active/done/archived`); events + their paperwork | read: member+ · create/edit: adviser+ | `event_type` + needs-papers/logistics flags decide which templates instantiate |
| **Project detail** | The live checklist generated from templates | check-off: officer+ | Checklist is a snapshot — later template edits don't apply |
| **Papers** | Registry of physical documents being routed for signature | read: member+ · register: officer+ | `doc_type` auto-picks the signatory chain |
| **Paper detail** | Signatory steps + append-only custody timeline | sign/skip & move: officer+ | Skip needs a reason; movements can't be edited or deleted |
| **Members** | Roster (roles, remove) + org chart | read: member+ · manage: owner | Can't change your own role; owner isn't reassignable here |
| **Settings** | members, positions, duty, templates, chains, contacts, invites, audit | view: adviser+ · write: owner | Everything autosaves on edit; audit tab is read-only |
| **Onboarding** | Create org / redeem invite / join request | any signed-in user | Org ID lives at the top of Settings — share it for join requests |
| **Account** (`/account`) | Your name, photo, per-org powers, password/email, theme, sign out, delete account | everyone | Reach it via your avatar in the sidebar/More sheet; deletion blocks if you're a sole owner — delete the org or hand it off first |

## Appendix — handbook ↔ app mapping

| Handbook section | Lives in CounciLog as |
|---|---|
| §3 Concept paper checklist | "Concept Paper Pack" template (paper track) |
| §4–5 Signatory routing | Signatory chains: `concept_paper`, `board_resolution` |
| §6 Activity reports | `activity_report` doc_type + questions → contacts (Ate Daphne) |
| §7 Financial report | "Financial Report" template; submit to CHECK ≤1 week |
| §8 Semester-end report | Paper trail: papers + journal + audit are the attachments |
| §9 Venue reservation | Event Logistics items + hints (GSD, Coach, IHM rules) |
| §10 Events checklist | "Event Logistics" template (logistics track) |
| §11–12 Outside events | "Outside Event Pack" template (CHED letter, consent, curriculum, medical, van) |
| §13 CES | `ces_concept_paper` chain with the Sir Bennyl step |
| §14 Duty roster | Settings → duty schedule |
| §15 Quick reference | Settings → contacts |
| §2 Pending handover items | Not seeded — create them as projects/tasks yourself |

## Known gaps (today)

- **Rules engine is API-only.** Conditional items (`include_if_event_type`,
  `include_if_flag` for merch, `due_days_before/after_event`) and chain
  conditions exist in the API but the Settings forms only take plain labels —
  use the Skip-with-reason workaround from A6.
- **No seed data.** Spec §9's CCS seed script doesn't exist yet — everything in
  A1 is manual entry (that's why the copy-paste blocks are there).
- **Template snapshots.** Regenerating a checklist after editing a template
  isn't offered in the UI; create the checklist once you're sure.

## See also

- `ROLES.md` — the full role matrix and join flows
- `spec.md` — the product spec this implements
- `../COUNCIL_HANDBOOK_V2.md` — council processes and who to ask
