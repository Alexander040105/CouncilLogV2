# CounciLog — Design Direction

> Spec-phase design brief for the web client. Mode: **Operate** — this is a
> task-completion tool officers open on phones between classes. Scanability,
> consistency, and speed outrank decoration; brand lives in precise details.
> All tokens are org-white-label-able: nothing below hardcodes CCS branding.
>
> **Canonical visual system: Neo-Brutalist** (see `neo-brutalist-style-guide.md`) —
> white base, navy `#27146e`, amber `#f4be04`, black strokes, squared corners,
> hard offset shadows, uppercase labels. The pre-brutalist "classic" dark and
> light themes ship as opt-in variants.

---

## 1. Design tokens

### Theme variants

**Neo-Brutalist Light (`brutalist-light`) is the shipped default** — it also
applies on bare `:root`, so first paint is already branded. Users pick among
four variants via the `ThemePicker` (a labeled `<select>` — not a binary
toggle), shown in three places: desktop sidebar footer, mobile More sheet,
and `/account` preferences + Settings. The choice persists in
`localStorage['councilog.theme']`; an inline `<head>` script in `index.html`
applies `data-theme` before first paint so there's no flash.

| `data-theme` | Character | Notes |
|---|---|---|
| `brutalist-light` (default) | white surfaces · black 2px strokes · amber accents · navy fills/text · 0 radii · hard offset shadows | guide §1 palette verbatim |
| `brutalist-dark` | near-black surfaces · bone `#f2f0ea` strokes · amber accents · navy as fills only | derived — the guide is light-only |
| `light` / `dark` | the original classic themes, unchanged | retained for users who prefer them |

**Contrast rules (hard requirements):**
- Amber `#f4be04` is always a *fill* with black text — never amber text on
  white (fails AA).
- Navy `#27146e` is a fill or text color in light mode; in `brutalist-dark`
  it may be a fill but **never a stroke** (too dark against near-black).
- Danger = `--status-alert` fill + white text.

### Divergence mechanism

One component tree serves all four themes. Everything variant-specific is a
CSS var scoped to `html[data-theme="…"]`; components never branch on theme or
use `dark:` classes / hardcoded hex.

**Color tokens** (semantic roles, per-variant values in `index.css`):

`--surface` page bg · `--surface-2` cards · `--surface-3` raised/hover ·
`--ink` / `--ink-2` / `--ink-3` text ramp (all ≥4.5:1 on surface-2) ·
`--line` borders/dividers · `--accent`/`--accent-fg` primary actions,
active nav, selection · `--brand`/`--brand-fg` fills, caret ·
`--status-pending` / `--status-done` / `--status-skip` / `--status-alert` ·
`--duty-extra` extra-duty flag.

**Structural tokens** — this is where the variants actually differ:

| Token | Brutalist | Classic | Controls |
|---|---|---|---|
| `--radius-input` / `--radius-card` / `--radius-sheet` | `0` | `6`/`10`/`16` px | all corners |
| `--avatar-radius` | `2px` | full round | avatar shape |
| `--border-el` | `2px solid` ink | `0` | element outlines (buttons, avatars) |
| `--border-box` | `2px solid` ink | `1px solid line` | boxes (cards, inputs, sheets, tables) |
| `--border-dash` | `2px dashed` ink | `1px dashed line` | upload affordances |
| `--shadow-1` / `--shadow-2` | `4px`/`12px` hard offset | `none` | hover lift / modals+sheets |
| `--press-transform` | `translate(2px,2px)` | `none` | button press-shift |
| `--nav-active-bg` / `--nav-active-fg` | accent fill + black text | `surface-3` + ink | active nav/tab/tab-group state |
| `--hover-fill` | darker surface tone | `line` | secondary-button hover |
| `--focus-color` / `--focus-width` | navy, `3px` / amber `3px` | accent, `2px` | `:focus-visible` ring |
| `--label-transform` / `--label-tracking` / `--label-weight` | `uppercase` · `0.05em` · `700` | `none` · `normal` · `600` | `.label-strong` — buttons, field labels, nav items, section eyebrows, chips |
| `--heading-weight` | `800` | `700` | `.heading-strong` — page/card titles |
| `--border-empty` | `2px dashed line` | `none` | `Empty` state frame |

**Chips** are fully tokenized per kind — `--chip-{kind}-{bg,bd,fg}` +
`--chip-radius`. Brutalist = solid fills with black text (amber) or white
text (navy/red/green) inside 2px strokes; classic = transparent fill,
1px colored outline, colored text (the pre-existing look).

Browser surfaces follow the theme: `color-scheme`, `::selection` = accent,
caret = brand, scrollbar thumb = `surface-3`, `:focus-visible` ring.

Every status chip renders `label + icon + color` — color is never the only
signal (a11y + projector/print contexts).

### Typography

One family — a humanist sans with strong legibility at small sizes
(e.g., Inter or system stack fallback). Scale (rem, 16px base):

`12 caption · 14 body-sm · 16 body · 18 lead · 20 h4 · 24 h3 · 30 h2 · 36 h1`

Weights 400/500/600/700 only — plus `800` on `.heading-strong` in brutalist
variants. In brutalist themes, `.label-strong` (buttons, field labels, nav
items, section eyebrows, chips, tab labels) renders uppercase with `0.05em`
tracking; classic themes render it at normal case/weight 600. Tabular
numerals for dates/counts.

### Space, shape, depth

- **Spacing scale:** 4pt base — `4 8 12 16 20 24 32 48`.
- **Radii/borders/elevation:** tokenized (see §1 structural table) —
  brutalist: squared corners, 2px ink strokes, hard offset shadows,
  press-shift on buttons; classic: `6`/`10`/`16` radii, 1px lines, faint
  shadows.
- **Density:** Operate-mode default is compact-comfortable; journal feed can
  breathe more than admin tables.

## 2. Component primitives

Buttons (primary/secondary/ghost/danger; ≥44px touch height), inputs w/
inline error + hint slots, selects, date picker (mobile-native friendly),
checkbox list rows (checklist items: label · hint · due chip · done state ·
done-by avatar), cards, tables that collapse to card rows under 768px,
status chips (pending/signed/skipped/done/overdue/extra-duty/no-tasks —
always icon + label, never color alone), photo thumbnails
(aspect-preserving, skeleton shimmer), `PhotoPicker` (capture-or-upload:
Take photo opens an inline `getUserMedia` viewfinder with shutter;
Upload keeps the native file picker + `capture` attribute; thumbnail
strip with per-photo remove; `max` prop caps attachments — 4 for journal
entries, 1 for custody moves; camera stream is always released on
close/cancel/unmount), avatar+name pairs, bottom-sheet
(mobile compose/menus), `Toast` (success/error, bottom-center mobile /
bottom-right desktop, 4.5s + manual dismiss, `aria-live`), `ConfirmDialog`
for destructive/irreversible actions (join-request reject, step skip) —
with an optional `requireText` type-to-confirm gate for the
hardest-to-reverse actions (account deletion),
`HintBanner` (first-visit one-liner, dismiss persists per-key in
localStorage), `PageHeader` (title + one plain-language line + action slot —
every page), empty-state blocks (icon + line + CTA — every list defines
one), skeletons for every async region.

Icons: **lucide-react only** — 20px in desktop nav, 22px in mobile tabs,
`aria-hidden` when decorative, never alone on destructive/ambiguous actions.
No unicode glyphs or emoji as icons.

Nav: **mobile = bottom tab bar** (Today, Journal, Attendance, Projects +
**More** sheet holding Papers, Members, Settings, org switcher, theme
picker, sign out); **desktop = left sidebar** echoing the legacy IA with
the labeled org switcher, theme picker, and sign-out at the foot.
**Account** (`/account`) is not a nav item — it's reached by tapping the
avatar/name in the sidebar footer or More sheet. Its pattern: stacked
`Card` sections — identity (avatar via `PhotoPicker` + name), "What you
can do" capability cards per org membership, security (password/email),
preferences (theme), and a visually quiet **danger zone** (alert-tinted
border, sign-out + typed-confirm delete).

Copy convention: plain language over jargon — "who signs, in order" not
"signatory chain", "hasn't filed yet" not "unaccounted", "your assigned
day" not "duty day". Product terms that must stay get a one-line subtitle.

## 3. Key surfaces

**Daily entry (the money flow, ≤3 taps).** From anywhere: compose sheet →
camera/photo picker → one-line description → optional project tag → post.
Peer option: single toggle "No tasks today" → confirm. States: filed/
unfiled are visible on the dashboard card the moment it lands.

**Journal feed.** Photo-centric vertical feed grouped by day; each card =
photo thumb, member avatar+name, description, project chip; duty vs extra
flag shown subtly. Day header shows org filing coverage (e.g., "4/5 duty
officers filed").

**Attendance views.** Week grid: members × weekdays, cell = documented /
no-tasks / unaccounted / extra icon+label; summary row = compliance %.
Day roster: filed vs not, tap → their entries.

**Project detail.** Header (title, target date, owner, status, event-type
chip) → two checklist tracks side-by-side on desktop, stacked tabs on
mobile (Papers · Logistics), each item with due chip computed from rules;
linked documents strip; linked journal strip.

**Creation previews.** New document and new project sheets show a live
preview of the automation before it's committed — the doc-type select
resolves the matched signatory chain and lists its steps (or warns the
paper won't route), and the papers/logistics + event-type inputs list the
checklist templates and items that will instantiate. Client mirrors the
server match rules (`web/src/lib/rules.js` ↔ `instantiate.py`); empty
matches warn and route owners to Settings.

**Diagnosis over silence.** The same preview doubles as the project-detail
empty state: it names the exact blocker (`no_needs`, `no_templates`,
`track_mismatch`, `event_type_mismatch`, `items_filtered` — one enum shared
between `instantiate.py` and `rules.js`) and the API echoes the same
`reason`. Mismatches offer escape hatches rather than dead ends — adviser+
can force-pick a template, officer+ can attach a chain to an unrouted
document, and Settings shows per-chain "covers N papers" counts so dead
config is visible.

**Revision rounds.** Sent-back papers append a new round of signatory rows —
never rewrite history. The logbook groups steps by round ("Round 1", "Round
2 — revision") with an amber "Returned for revision" banner carrying the
reason between rounds; `sent back`/`superseded` rows get `alert`/`skip`
chips. Single-round docs render flat (no header noise). "Sign all pending"
covers the same-day re-sign fast path behind a ConfirmDialog.

**Paper logbook (document detail).** Vertical timeline interleaving:
signature steps (pending → signed w/ who+when) and custody movements
(where, who, photo, time). Current location = topmost movement, pinned as a
card. "Move paper" action = location text + optional camera shot.

**Org chart.** School-year selector → position tree (`reports_to`), holder
avatar+name, vacant badges; owner gets drag/assign controls in settings.

**Admin/settings (owner).** Editors for positions, duty schedule
(weekday→member multi-select grid), checklist templates (ordered item
editor w/ rules), signatory chains (ordered steps + condition flags),
contacts directory, invites, audit log (read-only table, filterable).

**Onboarding.** Split: "Start your organization" vs "Join with code /
request access" — two cards, one screen; Google button on both paths.

**Guide (`/guide`).** The app's first Read-mode surface — comprehension over
task-completion: prose sections, expandable worked examples (the starter
library), and owner-only "Add to my org" install actions. Linked from
Settings tabs and the preview/diagnosis surfaces where confusion happens.

## 4. Layout rules

- **Mobile-first at 360px** — every surface designed there first; desktop
  widens into side-by-side panels, never stretched single columns.
- Bottom tab bar on mobile; destructive and primary actions thumb-reachable.
- Content max-width ~1120px; admin tables may use full width.
- Photo input = `PhotoPicker` everywhere: in-app webcam capture (`facingMode`
  `ideal: 'environment'`, mirrored front-cam preview) plus file upload; denied
  or missing cameras fall back to upload with a plain-language notice.

## 5. Accessibility floor

WCAG AA: contrast ≥4.5:1 body text, ≥3:1 large/UI; visible focus ring on
everything interactive; all actions reachable by keyboard; touch targets
≥44px; status never color-only; `alt` on journal photos = member description
auto-seed; reduced-motion honored for feeds/sheets.

## 6. Signature moments (small, deliberate)

- The dashboard "Your day" card flipping from *unfiled* → *documented*
  with a quiet success state — the daily dopamine that drives retention.
- The logbook timeline "paper moved" stamp — feels like stamping a real
  logbook; keep the metaphor, not skeuomorphism.
- Org chart switch between school years — a fast way to feel the product's
  memory.
