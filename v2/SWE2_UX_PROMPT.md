# SWE-2 Prompt — CounciLog UX pass: dark-first theme, navigation clarity, first-timer UX

You are a senior product engineer with design-director taste. CounciLog's MVP
is functionally complete and verified end-to-end; the UI works but is bare —
light-only theme, unicode-glyph nav icons, no toasts or confirm dialogs, thin
empty states, and jargon an outsider won't decode. Your mission: make the app
feel **finished and self-explanatory for a first-time user on a 360px phone**,
with a **proper dark-first theme**. This is an Operate-mode tool — polish the
task flows, don't decorate for its own sake.

Work at the repo root (`CouncilLogV2/`). All implementation lives in `v2/web/`.

---

## §1 Read before you touch anything

1. `v2/PRODUCT.md` — who this is for (student officers, phones, duty days),
   brand voice (competent, unfussy, slightly playful).
2. `v2/DESIGN.md` — the design direction. You will UPDATE it in WP6; until
   then it's the source of truth for tokens, primitives, and layout rules.
3. `v2/spec.md` §screens — what each page is supposed to do.
4. All of `v2/web/src/` — current implementation, all plain JS/JSX.
5. If the `impeccable` skill is installed in your environment: run
   `impeccable context --target v2/web` once at session start, and read
   `reference/craft-floor.md` before your first UI edit. If it is not
   installed, skip silently — it is optional, not a dependency.

---

## §2 Hard constraints — violations are regressions

- **Plain JavaScript/JSX only.** No TypeScript syntax, no `.ts`/`.tsx` files,
  no `typescript`/`@types/*` deps. The maintainer only knows JS.
- **Tailwind v4 token architecture preserved.** All color flows through the
  CSS vars in `src/index.css` (`--color-*`). Per-org white-label overrides
  are a planned feature — nothing may hardcode CCS branding or literal hex
  values inside components.
- **Exactly one new dependency allowed: `lucide-react`.** Nothing else —
  no theme libs, no icon packs, no animation libs.
- **Operate mode.** Scanability > expression. No decorative gradients, no
  display fonts, no hero imagery inside the app shell.
- **Mobile-first at 360px**, ≥44px touch targets, WCAG AA contrast in **both**
  themes, status signals always `icon + label + color` (never color-only).
- **Web scope only.** Do not modify `v2/api/` or `v2/supabase/`. If a UX idea
  needs an API change, note it and work around it client-side.
- **Do not regress these recent fixes:**
  - `Login.jsx` — auth methods must be called bound on `supabase.auth`
    (`supabase.auth.signInWithPassword(...)`), never extracted as bare fns;
    `busy` resets in `finally`.
  - `AppShell.jsx` — org-less users redirect to `/onboarding`; org switcher
    has a `+ create or join…` option; `['me']` cache invalidation pattern.
  - `Journal.jsx` — `?compose=1` and `?notasks=1` deep-link params.
- **No secrets.** Never read or copy values out of `.env` files.

---

## §3 Work packages

### WP1 — Dark-first theme system

Dark is the **default** for every user; light is opt-in via toggle.

1. **Token ramps.** In `src/index.css`, define a full dark ramp mirroring
   every existing token. Approach: keep `@theme` tokens pointing at vars,
   define light values under `html[data-theme="light"]` and dark values as
   the `:root`/`html` default (dark-first). Every token in the current file
   must exist in both ramps:
   `accent, accent-fg, surface, surface-2, surface-3, ink, ink-2, ink-3,
   line, status-pending, status-done, status-skip, status-alert, duty-extra`.
   - Dark surfaces: a neutral dark ramp — page bg ~`#0f1115` family, NOT pure
     `#000` (pure black kills elevation cues and smears OLED shadows).
   - Dark ink ramp: near-white `#f2f4f8` → mid grays; verify ≥4.5:1 vs all
     surfaces.
   - Status colors: re-tune for dark bg (lighten amber/green/red ~10–20% so
     they hold AA on dark surfaces; keep `--duty-extra` visibly distinct
     from `--status-alert`).
   - Pick ONE swap mechanism (var-swap on `data-theme`). Do NOT mix in
     Tailwind `dark:` classes — the var swap covers everything already.
2. **Anti-FOUC.** Inline `<script>` in `index.html` `<head>` before any CSS:
   reads `localStorage['councilog.theme']`; sets
   `document.documentElement.dataset.theme`; absent → `'dark'`. No flash of
   wrong theme on reload.
3. **Theme state.** `src/lib/theme.jsx` — `ThemeProvider` + `useTheme()`
   returning `{ theme, setTheme }`; `setTheme` writes localStorage +
   `data-theme`. Wire provider in `main.jsx`.
4. **Toggle UI.** A light/dark toggle (icon: sun/moon via lucide) in:
   (a) Settings page, (b) sidebar footer next to sign-out on desktop, and
   (c) reachable on mobile (sheet/menu or settings — your call, must exist).
5. **Audit pass.** Check Sheet overlay, Skeleton shimmer, Chip borders,
   focus rings, the dashed photo-drop button, and disabled states in BOTH
   themes. Anything illegible in dark gets fixed at the token or component
   level.

### WP2 — Icon system

1. `npm i lucide-react` (pin a version ≥7 days old).
2. Replace every unicode/emoji glyph with a lucide icon:
   - `AppShell` `NAV` map: Today, Journal, Attendance, Projects, Papers,
     Members, Settings — pick semantically honest icons, consistent weight,
     `size={20}` desktop / `size={22}` mobile tab bar, `aria-hidden`.
   - `Journal` compose button `📷 Add photo` → `Camera`/`ImagePlus`.
   - Chip `icon` props currently passed as strings (`✓`) — change the
     `Chip` API to accept a lucide component or small element.
   - Sign-out, close-✕ in `Sheet`, org-switcher affordances.
3. Icons never appear alone for destructive or ambiguous actions — label or
   `aria-label` always present.

### WP3 — Navigation clarity

1. **`PageHeader` primitive** in `components/ui.jsx`:
   `title` + one-line `description` + optional `action` slot. Applied to
   every page. Descriptions explain the page to someone who's never seen
   it, e.g.:
   - Today — "Your duty day at a glance: file once, you're accounted."
   - Journal — "Photo + a line about what you did — that's the day's record."
   - Attendance — "Who filed, who hasn't — a filed day counts, not a clock-in."
   - Projects — "Events and the paperwork + logistics behind them."
   - Papers — "Where physical documents are and who's signing them."
   - Members — "Roster, org chart, and this school year's positions."
   - Settings — "Org structure, templates, invites, and audit log."
2. **Back navigation.** `ProjectDetail` and `DocumentDetail` get a
   `← Projects` / `← Papers` link above the header.
3. **Mobile overflow.** The bottom tab bar currently `.slice(0, 6)` — if an
   admin item can be orphaned, add a `More` tab that opens a sheet with the
   remaining items. Verify an owner on mobile can reach Settings.
4. Keep the org switcher; add a tiny label or hint so a new user knows it
   selects the organization they're viewing.

### WP4 — First-timer UX

1. **Empty states everywhere.** Audit every list/feed/grid; each gets the
   `Empty` primitive with icon + one plain-language line + one CTA:
   journal feed, attendance grid, projects, documents, members/org-chart
   (vacant state), templates, chains, contacts, audit log.
2. **Dismissible hints.** A `HintBanner` primitive (info-tinted card, one
   sentence, ✕ dismiss, persisted per-key in localStorage) shown on first
   visit to: Journal ("Entries here prove your duty day — photo optional
   but encouraged"), Attendance, Papers ("This is the digital logbook for
   physical documents"), Projects, Settings for non-owners explaining
   read-only if applicable.
3. **Jargon audit.** Replace or subtitle insider terms:
   - "signatory chain" → "who signs, in order"
   - "unaccounted" → "hasn't filed yet"
   - "duty day" → "your assigned day"
   - "instantiate" (if user-visible anywhere) → "generate checklist"
   Where a term must stay (product vocabulary), give it a one-line subtitle
   or `title` hint.
4. **Join-flow dead end.** Requesting to join needs the org's raw UUID —
   invisible to normal users. In Settings (admin view), add a "Copy org ID"
   affordance + a line explaining admins share it with people who want to
   request access. On the Onboarding join card, label the field
   "Organization ID" with hint "The org admin can copy this from Settings".
5. **Dashboard zero-state.** For a fresh org (no filings, no positions),
   a short "what happens here" card: file a journal entry each duty day;
   papers and projects live in their tabs; admins set up positions and
   templates in Settings. One card, three bullets, links.

### WP5 — Feedback layer

1. **`Toast` system** — `components/ui.jsx` + `lib/toast.jsx` context:
   `toast.success(msg)` / `toast.error(msg)`; stacked bottom-center on
   mobile, bottom-right desktop; auto-dismiss ≥4s; `role="status"`,
   `aria-live="polite"`. Wire success/error feedback into every mutation
   already in the app (journal post, no-tasks, checklist check, movement,
   sign/skip, settings saves).
2. **`ConfirmDialog` primitive** — for destructive/irreversible actions
   (member removal, signatory step skip, anything deleting state). Title +
   consequence line + confirm/cancel; danger variant for destructive.
   Wire it where those actions exist; do not add new destructive features.
3. **Skeletons everywhere.** Audit every `useQuery` call site — each
   loading region shows a `Skeleton` shaped like the real content, not a
   blank or a spinner.
4. **Error consistency.** Mutation errors → field-level message when the
   cause is field-shaped, else `toast.error`. Kill orphan inline-only
   error states that leave the user guessing. `get/post` ApiError messages
   are already human-readable — surface them.
5. **Error boundary.** React error boundary around the app shell: friendly
   "something broke" card + reload button + sign-out escape. Log details
   to console, never to the user's face.

### WP6 — DESIGN.md sync

Update `v2/DESIGN.md` so it stays the source of truth:
- Rewrite the "light mode is the shipped theme; dark mode is an optional
  later phase" line → dark-first is shipped; document the toggle +
  persistence + anti-FOUC mechanism.
- Add the dark ramp as a second column in the color token table.
- Document: lucide icon policy (sizes, aria rules), PageHeader pattern,
  HintBanner, Toast, ConfirmDialog, skeleton rule ("every async region"),
  and the jargon-to-plain-language convention.

---

## §4 Acceptance criteria — the pass/fail list

- [ ] `cd v2/web && npm run build` succeeds (vite only, no tsc).
- [ ] No `.ts`/`.tsx` files under `v2/web/src/`; only new dep is
      `lucide-react`.
- [ ] `grep -r "#[0-9a-fA-F]\{3,8\}" src/` outside `index.css` returns
      nothing; no `bg-white`/`text-black` class usage.
- [ ] First load renders dark; toggle switches to light and survives a
      reload with zero theme flash.
- [ ] Every token used in light exists in dark; status colors pass AA on
      dark surfaces.
- [ ] Every page has a `PageHeader` with a plain-language description;
      detail pages have back links.
- [ ] Every list/feed has an `Empty` state with CTA; first-visit
      `HintBanner`s dismiss and stay dismissed.
- [ ] Every mutation produces toast or field-level feedback; destructive
      actions go through `ConfirmDialog`; every `useQuery` region has a
      skeleton.
- [ ] Nav uses lucide icons on both desktop sidebar and mobile tab bar;
      admins can reach Settings on mobile.
- [ ] Settings exposes a way for admins to find/copy the org ID.
- [ ] 360px and 1280px both hold up: no clipped controls, no dead ends.
- [ ] `v2/DESIGN.md` updated to match shipped behavior.

---

## §5 Verification sequence

1. `npm run build` — must pass before you claim done.
2. Grep checks from §4.
3. Manual smoke in dev server: load as dark, toggle to light, reload,
   toggle back — no FOUC either direction; walk Today → Journal →
   Attendance → Projects → Papers → Members → Settings in both themes at
   360px and 1280px.
4. If `impeccable` is installed: run
   `impeccable detect --json` on the changed files once at the end and fix
   real findings (skip stylistic noise that contradicts §2).

---

## §6 Out of scope

API/backend changes, new routes or features, org-brand customization,
photo capture UI changes, animation beyond subtle transitions,
React Native, and anything requiring new dependencies besides lucide-react.
Note good ideas you deliberately didn't implement in a short
"future polish" comment at the end of your report — don't sneak them in.

---

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. `npm run build` output (last lines).
3. The §4 checklist with actual pass/fail results.
4. Future-polish notes (short).
