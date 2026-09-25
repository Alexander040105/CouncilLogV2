# SWE-2 High Prompt — CounciLog: Neo-brutalist reskin + theme variants

You are a senior product engineer. CounciLog is a multi-tenant ops tool
(FastAPI + React/Vite/Tailwind v4). Its design system is token-driven —
everything resolves through CSS variables in `web/src/index.css`. Your
mission: **reskin the app to neo-brutalism per `v2/neo-brutalist-style-guide.md`,
shipped as the DEFAULT theme variant in a 4-variant theme system**, and make
`v2/DESIGN.md` reflect the new canon.

Work at repo root (`CouncilLogV2/`). **Web only** — no API, DB, or auth
changes. App code: `v2/web/`.

---

## §1 Read before you touch anything

1. `v2/neo-brutalist-style-guide.md` — **the canon**. Palette is the
   document's (white `#FFFFFF`, navy `#27146E`, amber `#F4BE04`, black
   `#000000`, semantic green/red) — NOT any poster/mockup colors.
2. `v2/DESIGN.md` — current system; you'll rewrite the divergent parts.
3. `v2/PRODUCT.md` — Operate-mode tool on phones; clarity > decoration.
4. All of `v2/web/src/` — especially:
   - `index.css` — the `@theme` + `html[data-theme]` token ramps you extend
   - `lib/theme.jsx` — current `dark|light` persistence
   - `components/ui.jsx` — `Button/Input/Select/Field/Card/Chip/Empty/
     HintBanner/Skeleton/Sheet/ConfirmDialog/Avatar/ThemeToggle/
     PageHeader/ErrorBoundary`
   - `components/PhotoPicker.jsx`, `components/AppShell.jsx`
   - every page in `pages/` — you touch all of them in WP5
5. If `impeccable` is installed: `impeccable context --target v2/web` once
   at start; run `impeccable detect --json` on changed files at the end.

---

## §2 The theme model — 4 variants, brutalist-light default

| `data-theme` | What it is |
|---|---|
| `brutalist-light` | **New default.** White base, navy/amber/black per the guide. |
| `brutalist-dark` | Derived variant (guide is light-only — see WP2 for the ramp you must define). |
| `dark` | The current shipped dark theme — **unchanged**. |
| `light` | The current light theme — **unchanged**. |

- `theme.jsx` currently persists `dark`/`light`. Extend it to the 4-variant
  set, default `brutalist-light`, same localStorage persistence. A stored
  `dark`/`light` value keeps working (legacy values are still valid
  variants — no migration needed beyond accepting the old strings).
- `ThemeToggle` (sun/moon icon button) → **`ThemePicker`**: a labeled
  `<select>` listing all four variants ("Neo-brutalist", "Neo-brutalist
  dark", "Dark", "Light"). Replace every `ThemeToggle` usage: AppShell
  sidebar footer, AppShell mobile More sheet, `/account` Preferences card.
- Structural props (radii, border thickness, shadow) diverge **only via
  CSS vars** — one component tree serves all four variants. Never branch
  JSX on theme.

---

## §3 Hard constraints — violations are regressions

- **Plain JavaScript/JSX.** No TypeScript.
- **No new dependencies.** lucide-react already installed is fine.
- **All colors/elevations via `var(--*)` tokens** — zero literal hex in
  `components/`, `pages/` (hex lives only in `index.css` token definitions).
- **Contrast is variant-scoped and must pass AA in all four.** Two traps to
  respect: amber `#F4BE04` as *text* on white fails (~1.9:1) — amber is
  always a **fill with black text**; navy `#27146E` as a *stroke/border* on
  near-black fails — in `brutalist-dark` navy is only a fill with white
  text.
- **Brutalist variants are truly brutalist**: squared corners
  (`--radius-*` → 0/2px), hard-edged offset shadows only (never soft
  blur), thick borders on every interactive element and container, visible
  focus always, strict grid, no gradients.
- **Spacing scale only**: 4/8/12/16/24/48/96 (Tailwind `p-1/2/3/4/6/12/24`,
  `gap-*` equivalents). Type scale per §4.
- **≥44px touch targets** everywhere; mobile-first at 360px.
- **Don't regress:** classic `dark`/`light` variants must look identical to
  today; `['me']`/`['members']` invalidation patterns; bound auth calls;
  org-less → onboarding redirect with `/account` exemption.
- **No AI/tool attribution** (repo `AGENTS.md`).

---

## §4 Work packages

### WP1 — Theme infra
- `lib/theme.jsx`: variant list `['brutalist-light','brutalist-dark','dark','light']`,
  default `'brutalist-light'`, `setTheme` writes `data-theme` + persists.
- `components/ui.jsx`: replace `ThemeToggle` with `ThemePicker`
  (`Select`-style control, label "Theme", four options). Keep a `ThemeToggle`
  name → new component is `ThemePicker`; update AppShell (2 places) and
  `pages/Account.jsx` (Preferences card).

### WP2 — Token ramps in `index.css`
- `html[data-theme="brutalist-light"]` (also apply to bare `:root` so first
  paint before JS is already branded):
  - `--color-surface: #FFFFFF`, `--color-surface-2: #FFFFFF`,
    `--color-surface-3: #f2f0ea`-ish paper tint
  - `--color-ink: #000000`, `--color-ink-2: #27146E` (navy for secondary
    text/headings), `--color-ink-3`: dark grey ≥4.5:1
  - `--color-line: #000000`
  - `--color-accent: #F4BE04`, `--color-accent-fg: #000000`
  - new `--color-brand: #27146E` + `--color-brand-fg: #FFFFFF`
  - semantic: `status-done` green, `status-alert` red, `status-pending` =
    amber family (darker tone for text use), `status-skip` grey,
    `duty-extra` navy
  - `--radius-input/card/sheet: 0`
  - new elevation: `--shadow-1: 4px 4px 0 0 #000`,
    `--shadow-2: 12px 12px 0 0 #000`, `--shadow-0: none`
  - `--border-strong: 2px solid #000`
- `html[data-theme="brutalist-dark"]`:
  - surfaces `#121212` / `#1a1a1a` / `#242424`; strokes/bones
    `--color-line: #f2f0ea`, `--border-strong: 2px solid #f2f0ea`
  - `--color-ink: #f5f3ee`, `--color-ink-2: #cfc9ba`, `ink-3` readable grey
  - accent amber unchanged (amber on near-black ≈ AA), `accent-fg: #000`
  - `--color-brand` stays `#27146E` — used ONLY as a fill w/ `brand-fg:
    #fff`; never a border/stroke color in this variant
  - shadows offset to the bone/ink color
- Classic ramps untouched. Keep `color-scheme` correct per variant
  (brutalist-light → `light`, brutalist-dark → `dark`) — form controls and
  scrollbars depend on it.
- Update the `:focus-visible` rule to read from tokens (brutalist = thicker,
  high-contrast ring — e.g. 3px `var(--color-brand)` on light, bone on dark).

### WP3 — Primitives pass (`ui.jsx` + `PhotoPicker.jsx` + toast)
Make structure consume the new vars so classic variants render unchanged
and brutalist ones harden automatically:
- `Button`: `border: var(--border-strong, 0)` + `box-shadow` on
  hover→`var(--shadow-1, none)` + slight `-translate` (the brutalist
  "press" is: shadow shrinks, element shifts — implement via
  `hover:translate-x/y` + `hover:shadow`). primary = `accent` fill +
  `accent-fg` text, bold uppercase tracking; secondary = outline
  (transparent fill, `border-strong`, ink text); danger stays semantic red;
  ghost unchanged.
- `Card`: `border: var(--border-strong, 1px solid var(--color-line))` +
  optional `box-shadow: var(--shadow-1, none)` — cards that are containers
  (not every card needs a shadow; use judgment, keep it systematic).
- `Chip` → brutalist badge behavior via tokens: in brutalist variants chips
  are **solid-fill** blocks (pending=amber/black text, done=green/black or
  white, alert=red/white, extra=navy/white, skip=grey). Implement via new
  chip tokens (`--chip-<kind>-bg/fg`) or variant-scoped overrides — do not
  hardcode hex.
- `Sheet`/`ConfirmDialog`: `border: var(--border-strong)` +
  `box-shadow: var(--shadow-2, none)`; radius 0 via token.
- `Avatar`: gains `border: var(--border-strong)` (square by default in
  brutalist — drive `rounded-full` vs `rounded-none` via a `--avatar-radius`
  token so classic stays round).
- `Input`/`Select`/`Field` helper text; `Empty` bordered block; `Skeleton`
  pulse on `surface-3`; `Toast` bordered block w/ colored left edge.
- PhotoPicker buttons/video frame get the same bordered treatment.

### WP4 — Shell & navigation
- Sidebar + bottom tab bar: `border-right`/`border-top` → `var(--border-
  strong)`; active `NavLink` = solid `accent` fill block w/ `accent-fg`
  text (brutalist) vs today's surface-3 (classic) — via token or
  variant-scoped class.
- Org switcher `select` gets the bordered treatment.
- `/account` Preferences card shows the new `ThemePicker` with the 4
  options.

### WP5 — Page-by-page pass
Walk every route at 360px and 1280px in **all four variants**:
`login`, `onboarding`, `/` dashboard, `journal`, `attendance`, `projects` +
detail, `documents` + detail, `members`, `settings/*`, `account`.
- No literal sizes outside the spacing scale; no stray rounded classes
  that fight brutalist (e.g. `rounded-full` on chips is fine — pills exist
  in the guide for badges; rounded corners elsewhere must go through
  tokens).
- Duty/attendance/status tables: bordered rows + bold uppercase headers.
- Empty states get bordered-block treatment + filled CTA.
- Verify ≥44px targets survived (nav tabs, icon buttons, chip removes).

### WP6 — Docs
- `v2/DESIGN.md`: rewrite §1 tokens + relevant component/elevation/type
  sections to canon; document the 4-variant model (brutalist-light default,
  brutalist-dark, classic dark/light = legacy variants);
  `neo-brutalist-style-guide.md` remains the upstream reference.
- `v2/README.md`: if theme notes exist, update the variant list.

---

## §5 Acceptance criteria

- [ ] `cd v2/web && npm run build` clean.
- [ ] `grep -rn "#[0-9a-fA-F]{3,8}" web/src/components web/src/pages` → 0
      hits (hex only inside `index.css`).
- [ ] Theme picker shows 4 variants; `brutalist-light` is default on a
      fresh browser; choice persists across reload; switching is instant.
- [ ] Brutalist variants: zero rounded corners beyond 2px tokens, zero
      blurred shadows, every interactive/container bordered, focus ring
      always visible.
- [ ] Classic `dark`/`light` visually unchanged.
- [ ] AA contrast verified in all 4 variants (amber-fill chips use black
      text; navy never a stroke in dark).
- [ ] 360px + 1280px manual pass on every route; ≥44px targets intact.
- [ ] DESIGN.md reflects the new canon.
- [ ] No new deps, no TS, no attribution.

## §6 Out of scope

API/backend changes; per-org white-label overrides (stay classic-only —
note it in DESIGN.md); custom fonts (keep system stack); print styles;
touching `legacy_code/`.

## Output format

1. Ordered files-changed list w/ one-line why.
2. Build output tail + any screenshots/DOM snippets of the 4 variants.
3. §5 checklist with real results.
4. Contrast decisions you made + anything deferred.