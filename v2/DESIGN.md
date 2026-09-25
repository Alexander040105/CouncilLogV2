# CounciLog — Design Direction

> Spec-phase design brief for the web client. Mode: **Operate** — this is a
> task-completion tool officers open on phones between classes. Scanability,
> consistency, and speed outrank decoration; brand lives in precise details.
> All tokens are org-white-label-able: nothing below hardcodes CCS branding.

---

## 1. Design tokens

### Color

**Dark is the shipped default theme** — officers file at night between and
after classes, and dark surfaces keep photo content legible. Light is opt-in
via the sun/moon toggle (sidebar footer + mobile More sheet + Settings),
persisted in `localStorage['councilog.theme']`; an inline `<head>` script in
`index.html` applies `data-theme` before first paint so there's no theme
flash. The mechanism is a CSS-var swap on `<html>` — components never use
`dark:` classes or hardcoded hex.

| Token | Dark (default) | Light | Role |
|---|---|---|---|
| `--accent` | `#6b76ff` | `#3f4dd1` | primary actions, links, active nav; per-org override later |
| `--accent-fg` | `#ffffff` | `#ffffff` | text/icons on accent |
| `--surface` | `#0f1115` | `#f7f8fa` | page bg — never pure `#000` (kills elevation cues) |
| `--surface-2` | `#161a22` | `#ffffff` | cards |
| `--surface-3` | `#1f2430` | `#f0f2f6` | raised/hover |
| `--ink` | `#f2f4f8` | `#14171f` | primary text — AA on all surfaces (aim AAA body) |
| `--ink-2` | `#c3cad6` | `#3d4454` | secondary text |
| `--ink-3` | `#8b93a5` | `#6b7280` | tertiary/hints — still ≥4.5:1 on surface-2 |
| `--line` | `#272d3a` | `#e3e6ec` | borders/dividers |
| `--status-pending` | `#f5a524` | `#b45309` | checklist/signatory pending — amber |
| `--status-done` | `#4ade80` | `#15803d` | signed / done / documented — green |
| `--status-skip` | `#9aa3b2` | `#6b7280` | skipped step / archived — neutral |
| `--status-alert` | `#f87171` | `#b91c1c` | unaccounted day, overdue — red, never color-only |
| `--duty-extra` | `#a78bfa` | `#6d28d9` | extra-duty flag — violet, distinct from alert |

Status colors lighten ~15% on dark to hold AA on `surface-2`. Browser
surfaces are themed too: `color-scheme` follows `data-theme`, selection =
accent, caret = accent, scrollbar thumb = `surface-3`, `:focus-visible` gets
a 2px accent ring.

Every status chip renders `label + icon + color` — color is never the only
signal (a11y + projector/print contexts).

### Typography

One family — a humanist sans with strong legibility at small sizes
(e.g., Inter or system stack fallback). Scale (rem, 16px base):

`12 caption · 14 body-sm · 16 body · 18 lead · 20 h4 · 24 h3 · 30 h2 · 36 h1`

Weights 400/500/600/700 only. Tabular numerals for dates/counts.

### Space, shape, depth

- **Spacing scale:** 4pt base — `4 8 12 16 20 24 32 48`.
- **Radii:** `6` inputs/chips · `10` cards · `16` sheets/modals.
- **Elevation:** restrained — cards sit on `surface-2` with 1px `line` +
  faint shadow; sheets/modals get real elevation; no floating-everything.
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
toggle, sign out); **desktop = left sidebar** echoing the legacy IA with
the labeled org switcher, theme toggle, and sign-out at the foot.
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
