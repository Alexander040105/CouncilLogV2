# Neo-Brutalist Design System

**Philosophy:** Bold. Loud. Systematic. Usable.

## Usage Rules (apply to every component)
- Thick black strokes on all interactive elements and containers
- Squared corners — limited/no border radius (max ~4px on select elements)
- Solid accent color blocks, never gradients or soft shadows
- Strict grid alignment — no floating/loose positioning
- High contrast between foreground and background at all times
- Focus states must always be visible (no `outline: none` without a visible replacement)
- Spacing scale: `0`, `4`, `8`, `12`, `16`, `24`, `48`, `96` (px) — use only these values

---

## Color Tokens

| Token | Hex | RGB | Usage |
|---|---|---|---|
| White | `#FFFFFF` | 255, 255, 255 | Base background, card fills |
| Navy/Indigo | `#27146E` | 39, 20, 110 | Primary actions, headings, borders/text alternative to black |
| Amber/Gold | `#F4BE04` | 244, 190, 4 | Primary accent — highlights, CTAs, badges, active states |
| Black | `#000000` | 0, 0, 0 | Strokes, borders, body text |

Rule: Navy is the primary brand/action color (can substitute for black on strokes/headings where more brand presence is wanted). Amber/Gold is the accent used for emphasis, CTAs, active/selected states, and badges. Use sparingly against the white base for maximum contrast and impact. Reserve pure black for default text/border where navy isn't used.

**Semantic colors (outside core palette):** This 3-color palette is brand-only. For system feedback (success/error) that shouldn't be confused with brand actions, use standard semantic colors — e.g. green for success, red for error/destructive — kept visually distinct from Navy and Amber. Warning states can use Amber directly since it already reads as an alert color.

---

## Typography Scale

| Style | Size | Use |
|---|---|---|
| H1 | 96px | Giant heading — hero/landing only |
| H2 | 64px | Large heading — section titles |
| H3 | 48px | Medium heading — subsections |
| H4 | 32px | Small heading — card/module titles |
| Body | 18px | Default reading text |
| Caption | 14px | Smaller descriptions, metadata |

- Font weight: bold/black for all headings
- All-caps is acceptable and encouraged for labels, buttons, and eyebrow text
- Tight, systematic hierarchy — don't invent in-between sizes

---

## Elevation Tokens

| Token | Value | Use |
|---|---|---|
| Shadow-0 | none | Default flat state |
| Shadow-1 | subtle, 4px offset, hard edge (no blur) | Hover/raised elements |
| Shadow-2 | prominent, 12px offset, hard edge (no blur) | Modals, popovers, "prominent" elements |

Note: all shadows are **hard-edged offset blocks**, not soft/blurred drop shadows — this is core to the brutalist look.

---

## Icons
Simple, thick-stroke, geometric line icons (close, check, settings, arrow, user, trash, search, menu, etc). No filled/gradient icon styles.

---

## Components

### Buttons
- **Filled (Primary)**: solid accent fill, black border, black text or white text depending on contrast
- **Outline (Secondary)**: transparent fill, colored border + text
- **Text (Tertiary)**: no border/fill, colored text only
- **Outline (Primary)**: black border, primary accent text
- **Destructive (Danger)**: red fill or outline (semantic red, outside core palette — see Semantic Colors note below)
- **Destructive (Outline/Ghost)**: outline-only danger variant
- **Disabled**: greyed fill, muted border, no interaction
- **Icon (Ghost)**: icon-only, subtle/no border until hover
- Minimum hit area: **44x44px**

### Inputs
- Black border, squared corners, white fill
- Error state: red border (semantic) + inline error message below field
- Helper text below field in caption style
- Toggle switches: square-ish pill, black border, accent fill when ON

### Controls
- Checkbox: square, black border, filled accent when checked
- Radio: circle, black border, filled accent dot when selected
- Toggle: black-bordered track, accent fill = ON, white/grey = OFF

### Navigation
- **Tabs**: bordered tab bar, active tab filled with accent color, optional count badge
- **Steps**: numbered circles connected by a line; active step filled accent, completed steps checked/filled, upcoming steps outlined
- **Pagination**: bordered number blocks, active page filled accent, prev/next as bordered buttons
- **Breadcrumbs**: plain text with `>` separators

---

## Data Display

### Card
- Thick black or navy border, white fill, hard shadow
- Bold title, body copy, primary button anchored at bottom

### List Item
- Bordered row/card with avatar or icon, bold name, description text, optional badge (e.g., "NEW", "ALERT")

### Badge
- Small solid-fill pill/rect, bold uppercase label, black border, color = accent per meaning (amber = new/alert, navy = neutral/info, semantic red/green = error/success)

### Avatar
- Square or circle, thick black border, initials or icon, solid background color

### Tooltip
- Black fill or black-bordered white box, white/black text, pointed connector to source element

### Table
- Bold uppercase column headers with sort icons, black border/rules, zebra or bordered rows, right-aligned "Actions" column with link-style buttons

---

## Feedback

### Toast Stack
- Stacked bordered blocks, dismiss (×) icon, color-coded left edge or fill by type (info/warning/error)

### Alert Banner
- Full-width bordered bar, icon + message, color-coded by severity: green = success (semantic), amber = warning (brand accent), red = error (semantic)

### Modal / Confirm
- Centered bordered box, hard Shadow-2, bold title, body text, Cancel (outline) + Confirm (filled) button pair
- Focus trapped and always visible

### Progress Bar
- Thick black-bordered track, solid accent fill, percentage label

### Empty State
- Bordered icon/illustration block, bold "No items yet" message, caption text, filled CTA button (e.g., "Create your first item")

---

## Implementation Notes for AI Agent
1. Default to squared corners; only use minimal radius (2–4px) where explicitly noted.
2. Never use soft/blurred box-shadows — always hard-edged offset shadows or none.
3. Every interactive element needs a visible black border and a visible focus state.
4. Only use the defined spacing scale (4/8/12/16/24/48/96) for margin/padding/gap.
5. Only use the defined type scale (96/64/48/32/18/14) for font sizes.
6. Use White as the base background, Navy for primary text/headings/borders and primary actions, and Amber as the standout accent for CTAs, active states, and highlights. Reserve semantic red/green strictly for error/success feedback, separate from Navy/Amber.
7. Maintain 44x44px minimum touch targets on all tappable elements (critical for mobile app).
8. Prefer bold/black font weights for headings and buttons; body text can be regular weight.
