/** Per-org accent/brand colors — applied as inline CSS-var overrides on top of
 *  whatever light/dark theme the user picked. Org theme never touches surfaces
 *  or ink, so readability and dark-mode preference survive.
 *  Presets are mirrored on the API (orgs.py ORG_PRESETS) — keep in sync. */

export const ORG_PRESETS = {
  default: { label: 'CounciLog', accent: '#f4be04', brand: '#27146e' },
  maroon:  { label: 'Maroon',    accent: '#f4be04', brand: '#7b1e2b' },
  forest:  { label: 'Forest',    accent: '#a3e635', brand: '#14532d' },
  sky:     { label: 'Sky',       accent: '#fde047', brand: '#1d4ed8' },
  plum:    { label: 'Plum',      accent: '#f0abfc', brand: '#6b21a8' },
  slate:   { label: 'Slate',     accent: '#94a3b8', brand: '#0f172a' },
};

/** black or white foreground, whichever reads better on the hex fill */
export function contrastFg(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 0xff) + 0.0722 * (n & 0xff)) / 255;
  return lum > 0.45 ? '#000000' : '#ffffff';
}

/** Custom hexes win over the preset's colors. Missing pieces stay default. */
export function resolveOrgTheme(theme) {
  if (!theme || typeof theme !== 'object') return null;
  const preset = ORG_PRESETS[theme.preset] ?? null;
  const accent = theme.accent ?? preset?.accent ?? null;
  const brand = theme.brand ?? preset?.brand ?? null;
  if (!accent && !brand) return null;
  return { accent, brand };
}

const VARS = ['--color-accent', '--color-accent-fg', '--color-brand', '--color-brand-fg',
              '--nav-active-bg', '--nav-active-fg', '--focus-color'];

export function applyOrgTheme(theme) {
  const r = resolveOrgTheme(theme);
  const el = document.documentElement;
  if (!r) { clearOrgTheme(); return; }
  if (r.accent) {
    el.style.setProperty('--color-accent', r.accent);
    el.style.setProperty('--color-accent-fg', contrastFg(r.accent));
    el.style.setProperty('--nav-active-bg', r.accent);
    el.style.setProperty('--nav-active-fg', contrastFg(r.accent));
  }
  if (r.brand) {
    el.style.setProperty('--color-brand', r.brand);
    el.style.setProperty('--color-brand-fg', contrastFg(r.brand));
    el.style.setProperty('--focus-color', r.brand);
  }
}

export function clearOrgTheme() {
  VARS.forEach((v) => document.documentElement.style.removeProperty(v));
}
