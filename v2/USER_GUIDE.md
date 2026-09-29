# CounciLog User Guide — CCS Council

How to run the council's real processes in CounciLog. This maps the handbook
(`../COUNCIL_HANDBOOK_V2.md`) onto the app — read this once as owner, then point
officers at the playbook they need.

- **Part A — playbooks:** do things the way the council actually works
- **Part B — feature reference:** what every page does and who can use it

> **Phone or browser?** Everything below applies to both — the mobile app
> (Expo) and the web app share the same account and org. In the app, Papers,
> Members, Guide, and Settings live under the **More** tab; Account and
> Admin too. See `mobile/README.md` for running it.

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
5. **Load the starter library.** Open **Guide → Starter library** (or hit the
   "New here?" card on the Settings templates/chains tabs). Every handbook
   workflow is there as a worked example — the four signatory chains (concept
   paper, board resolution, CES, financial report), five checklist templates
   (Concept Paper Pack, Event Logistics, Outside Event Pack, Financial Report,
   CES Activity), and the §15 who-to-ask contacts. Expand an entry to read what
   it contains and *why it's built that way*, then **Add to my org** — or "Add
   everything" to take the whole set.
   - Adding creates completely ordinary rows — edit or delete them in
     Settings → templates / chains / contacts like anything hand-typed.
   - Already-loaded entries say "already in your org" — you can't duplicate
     them; delete your copy and the Add button comes back.
   - The library teaches: the conditional RFP step, the `has_merch` and
     `off_campus` flags, and the CHED 15-day / CHECK 7-day due rules are all
     visible in the examples — read them before writing your own.
6. **Adapt to taste.** Settings → templates / chains → Edit any loaded entry:
   rename it, reorder rows, add your own items/steps, adjust offices and
   conditions. See "How matching works" below before inventing new event types
   or flags — matching is literal strings.
7. **Done.** Officers can now work — see playbooks below. Settings → audit is
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
- **Made a mistake?** Entries have **Edit** and **Delete** buttons. You can fix
  your own entry the same day; an owner can fix or remove anyone's anytime
  (owner corrections are recorded in the audit log). Photos can't be swapped
  on an existing entry — delete it and file again. Deleting the day's *last*
  entry un-marks the day (it shows as unaccounted until you re-file or
  declare no tasks). Declared "no tasks" by accident? Tap the **none** chip
  on today's grid to retract it — the same own-day/owner rule applies, and a
  *filed* day can't be retracted (delete the entry instead).

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
   - **Tick any flags that apply** ("This is…" checkboxes — e.g. `off_campus`,
     `has_merch`). The checkboxes only appear when a template item or chain
     step is gated on that flag; ticking one is what makes those gated items
     appear on the checklist.
   - The sheet **previews the checklist** that will generate from your
     papers/logistics + event type + flag choices — matching templates and
     their items, with due dates when a target date is set.
2. **Generate the checklist.** Open the project → the checklist card shows what
   will generate before you click — matching templates, their items, and due
   dates — and the button says how many items it will create. If nothing can
   match, the card says exactly why (no templates on the right track, event-type
   mismatch, project not flagged for papers/logistics) and points you to the
   fix. When templates exist but none auto-match, adviser+ can force-pick a
   template from the dropdown. Editing a template later won't rewrite existing
   checklists — snapshots are frozen.
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

1. **Register it** (officer+): Papers → New document → title + doc type. The
   doc-type dropdown lists types that already have chains — as soon as you pick
   one, the sheet previews the exact signing route it will follow (or warns
   that nothing will route). Use "custom…" for new types, or "Override chain"
   to pick a route manually. `doc_type` values to standardize on:
   `concept_paper`, `board_resolution`, `financial_report`, `activity_report`,
   `ces_concept_paper`, `letter`.
2. **Every hand-off = "Move paper"**: where it is now (e.g. "SD office",
   "with Ma'am Ana"), an optional note, and an optional photo of the
   paper/location. Movements are correctable but never silent — whoever moved
   it can fix or remove their record the same day, and owners can correct
   any (all logged in the audit trail). Deleting the newest movement reverts
   "current location" to the previous record; deleting a middle one only
   edits the timeline.
3. **Advance the chain** (officer+): mark each step **Sign** when done, or
   **Skip** with a required reason (recorded for the next signer — e.g. "office
   closed this week").
4. **Status flow:** `drafting → routing → signed → filed` — and `in revision`
   when an office sends the paper back.
5. **Registered before its chain existed?** The detail page explains why it's
   unrouted and offers an "attach a chain" picker (officer+) — no need to
   recreate the document. Owners: Settings → chains shows which doc types each
   chain covers and warns when a chain matches zero registered papers.

**Sent back for revision?** When an office returns the paper:

1. Tap **Send back** on the step that's holding it (or the header button on a
   signed/filed doc).
2. Say *what needs changing* — it becomes the note in the log.
3. Tick which offices must **re-sign** (all are pre-checked; untick any that
   don't need to). The paper re-routes through them, then returns to the
   requesting desk — as a new "Round" in the log. Old signatures are never
   erased.
4. **Fast path:** when everyone re-signs the same day, **Sign all pending**
   marks the whole round at once (with a confirm).

### A6. Handbook edge cases

- **International webinars (RFP):** the loaded chain already carries a
  conditional RFP step — it only attaches when the paper's linked project is
  `webinar_intl`. That's why the register sheet asks for a project: no linked
  project, no event-type conditions can fire. If the paper truly is for an
  international webinar and the RFP step is missing, link the project on the
  paper or attach the chain again.
- **Merch activities:** the Marketing/Bookstore step is gated on the
  `has_merch` flag — tick it on the document (or project) when the activity
  sells/produces merch and the step appears on the route.
- **Outside events:** tick the `off_campus` flag on the project and the
  Outside Event Pack items land on the checklist — including the CHED letter
  due 15 days before target date. The letter still goes to CHED **two
  channels** (hard copy to the City Hall Compound + email via Ma'am Lily at
  the Registrar). CES activities are the only exemption (§12).
- **Venue pencil bookings** lapse after 3 days without a finished concept
  paper — keep "finish papers first" ordering from §9.
- **Owner transfer** can't be done in the UI — ownership is set at org
  creation; it's a deliberate operation, ask a dev if needed. For the same
  reason, the **only owner can't be removed or demoted** — the app refuses
  (`SOLE_OWNER`) so an org never ends up ownerless. If the council is done
  and everyone should leave, **archive the org** instead (Settings → danger
  zone) — it disappears for all members and a CounciLog admin can restore
  it if anyone asks.

### A7. How matching works — the non-obvious rules

The **Guide** page (`/guide`, in the nav) covers this in-app; here's the same
list for the repo:

- A paper routes by its **document type** matching a chain's doc type
  *exactly* — `Concept Paper` ≠ `concept_paper`. Two chains on the same type:
  the alphabetically-first name wins; the register sheet's override picker
  exists for that reason.
- A template lands on a project when the **track** matches its needs
  (papers / logistics / both) AND the event types match — or the template has
  no event type, which means "every event".
- A project with a blank event type only picks up untyped templates.
- `include_if_flag` items/steps ("only when flag…") need the matching checkbox
  ticked on the project or document — and the checkbox only exists because
  some template or chain uses that flag name. Flags currently established by
  the starter library: `has_merch`, `off_campus`.
- "Only for event type" steps need the document **linked to a project** with
  that event type — that's why the register sheet asks for a project.
- "Due N days before/after the event" only computes when the project has a
  target date.
- Conditions are read **once, at creation**. Editing a template later never
  rewrites a live checklist or a routed paper — that's the snapshot
  guarantee. To fix a live checklist, edit its items directly; to add more
  from a template, the force-pick path asks to confirm because it appends.
- Generating a checklist twice is blocked — `409 ALREADY_INSTANTIATED` — so
  re-running can never duplicate rows silently.
- Steps aren't a gate — any officer can mark any pending step; it's a custody
  record. Skipping needs a reason. Sent-back papers open a new round; nothing
  is ever erased.
- A paper registered with no matching chain still gets its custody log —
  attach a chain later from its detail page.
- Standardize `doc_type`/`event_type`/flag spellings early — matching is
  literal strings (`webinar_intl`, not `intl-webinar`). The editors suggest
  existing values via dropdowns; new ones are free text — agree on them.

### A8. When in doubt

Settings → contacts mirrors the handbook's who-to-ask table. For anything the
app doesn't cover, the handbook is the source of truth:
`../COUNCIL_HANDBOOK_V2.md`.

---

## Part B — Feature reference

| Page | What it's for | Who can use it | Gotchas |
|---|---|---|---|
| **Today** (`/`) | Your duty status, today's roster, unaccounted-member count, quick links | everyone | "Nothing filed yet" until you log work or declare no-tasks |
| **Journal** | Photo + one-line work entries, grouped by day; optional project link | member+ | Photo optional; entries prove the duty day; edit/delete own-day (owner: any); deleting the day's last entry un-marks it |
| **Attendance** | Weekly filing grid + per-officer filing rate for the school year | everyone (read) | A "filed" chip needs a journal entry; ∅ = declared no tasks (tap to retract, own-day/owner); extra = off-day filing |
| **Projects** | Board by status (`draft/active/done/archived`); events + their paperwork | read: member+ · create/edit: adviser+ | `event_type` + needs-papers/logistics + flags decide which templates instantiate |
| **Project detail** | The live checklist generated from templates | check-off: officer+ | Checklist is a snapshot — later template edits don't apply |
| **Tasks** (`/tasks`) | Freeform assignments — assign work to anyone in the org, due dates, priorities, comments, links to projects/papers/journal entries | read: member+ · create/assign: member+ · edit/delete: creator or owner | Assignee can only mark done/reopen; assigning pings their inbox + email + push |
| **Agenda** (`/agenda`) | Every dated thing in the org — task deadlines, checklist items, project targets — grouped by day | everyone | Overdue rows flag themselves; empty = nothing has a date |
| **Papers** | Registry of physical documents being routed for signature — list or status **board** view | read: member+ · register: officer+ | `doc_type` auto-picks the signatory chain; board groups by where papers are in the chain |
| **Paper detail** | Signatory **process cards** (sign → sign → sign, with sent-back loops) + custody timeline pinned to each step | sign/skip & move: officer+ | Skip needs a reason; movements correctable by mover same-day or owner (audited); attach a photo when logging a hand-off |
| **Notifications** (bell) | Inbox: assignments, task comments, due-tomorrow pings, duty reminders | everyone | Tap a row to jump to the thing it points at; badge = unread count |
| **Members** | Roster (roles, remove) + org chart | read: member+ · manage: owner | Can't change your own role; owner isn't reassignable here; the only owner can't be removed — archive the org instead |
| **Guide** (`/guide`) | How chains/templates/flags work + the starter library | everyone (read) · install: owner | Library entries install as ordinary rows — nothing is locked |
| **Settings** | members, positions, duty, templates, chains, contacts, invites, audit + danger zone | view: adviser+ · write: owner | Templates/chains have full editors (hints, offices, conditions, due rules, reorder, delete); audit tab is read-only; owners can archive the org (hidden for everyone, admin-restorable) |
| **Onboarding** | Create org / redeem invite / join request | any signed-in user | Org ID lives at the top of Settings — share it for join requests |
| **Account** (`/account`) | Your name, photo, per-org powers, password/email, theme, sign out, delete account | everyone | Reach it via your avatar in the sidebar/More sheet; deletion blocks only while you're the sole owner of an *active* org — archive it in Settings first |
| **Admin** (`/admin`) | Every org incl. archived — view rosters, remove members, archive/restore orgs | CounciLog admins | Platform flag (`is_admin`) granted by the platform team, not assignable in-app; your actions show up in each org's audit log under your name |

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

### Offline on the phone app

The mobile app keeps working with no data connection: every save queues
locally and syncs when you're back online. A banner at the top tells you the
state — offline, queued items, syncing, or something that needs attention.
Queued items are reviewable under **More → Pending changes** (retry or
discard anything that couldn't sync). Entries and custody moves made
offline land in the same order you made them.

## Known gaps (today)

- **Template snapshots.** Checklists are frozen at generation — editing a
  template later never rewrites a live project's items. To change a live
  checklist, edit its items directly (or force-pick a template, which
  appends — it asks to confirm first).
- **No sequential enforcement.** Signatory steps record who signed, in listed
  order, but any officer can mark any pending step — it's a custody record,
  not a gate.

## See also

- `ROLES.md` — the full role matrix and join flows
- `spec.md` — the product spec this implements
- `../COUNCIL_HANDBOOK_V2.md` — council processes and who to ask
