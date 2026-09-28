/**
 * Mobile port of web/src/index.css — four theme palettes as plain objects.
 * Components resolve ALL styling through `useTheme()` — never hardcode colors.
 * Keep token names 1:1 with the CSS vars so a web style translates directly.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'councilog.theme';
export const THEME_CHOICES = ['system', 'brutalist-light', 'brutalist-dark', 'light', 'dark'];
export const THEME_LABELS = {
  system: 'System',
  'brutalist-light': 'Neo-brutalist',
  'brutalist-dark': 'Neo-brutalist dark',
  light: 'Light',
  dark: 'Dark',
};

const SHADOW = (dx, dy, color) => ({ dx, dy, color });
const NO_SHADOW = null;

const BRUTALIST_STRUCT = {
  radiusInput: 0, radiusCard: 0, radiusSheet: 0, avatarRadius: 2, chipRadius: 2,
  elWidth: 2, boxWidth: 2, dashWidth: 2,
  pressTranslate: 2, focusWidth: 3,
  labelTransform: 'uppercase', labelTracking: 0.8, labelWeight: '700', headingWeight: '800',
};
const CLASSIC_STRUCT = {
  radiusInput: 6, radiusCard: 10, radiusSheet: 16, avatarRadius: 999, chipRadius: 999,
  elWidth: 0, boxWidth: 1, dashWidth: 1,
  pressTranslate: 0, focusWidth: 2,
  labelTransform: 'none', labelTracking: 0, labelWeight: '600', headingWeight: '700',
};

const chipSet = (fills) => ({
  pending: fills.pending, done: fills.done, skip: fills.skip,
  alert: fills.alert, extra: fills.extra, neutral: fills.neutral,
});

export const PALETTES = {
  'brutalist-light': {
    name: 'brutalist-light', dark: false, ...BRUTALIST_STRUCT,
    surface: '#ffffff', surface2: '#ffffff', surface3: '#f2f0ea', hoverFill: '#e6e1d4',
    ink: '#000000', ink2: '#27146e', ink3: '#565656', line: '#000000',
    accent: '#f4be04', accentFg: '#000000', brand: '#27146e', brandFg: '#ffffff',
    pending: '#8f6400', done: '#15803d', skip: '#6b7280', alert: '#b91c1c', extra: '#27146e',
    elColor: '#000000', boxColor: '#000000', dashColor: '#000000', emptyBorder: '#000000',
    shadow1: SHADOW(4, 4, '#000000'), shadow2: SHADOW(8, 8, '#000000'),
    navActiveBg: '#f4be04', navActiveFg: '#000000', focus: '#27146e',
    chips: chipSet({
      pending: { bg: '#f4be04', bd: '#000000', fg: '#000000' },
      done: { bg: '#16a34a', bd: '#000000', fg: '#ffffff' },
      skip: { bg: '#6b7280', bd: '#000000', fg: '#ffffff' },
      alert: { bg: '#dc2626', bd: '#000000', fg: '#ffffff' },
      extra: { bg: '#27146e', bd: '#000000', fg: '#ffffff' },
      neutral: { bg: '#ffffff', bd: '#000000', fg: '#565656' },
    }),
  },
  'brutalist-dark': {
    name: 'brutalist-dark', dark: true, ...BRUTALIST_STRUCT,
    surface: '#121212', surface2: '#1a1a1a', surface3: '#242424', hoverFill: '#303030',
    ink: '#f5f3ee', ink2: '#d9d2c2', ink3: '#a89f8f', line: '#f2f0ea',
    accent: '#f4be04', accentFg: '#000000', brand: '#27146e', brandFg: '#ffffff',
    pending: '#f4be04', done: '#4ade80', skip: '#9aa3b2', alert: '#f87171', extra: '#b7abf5',
    elColor: '#f2f0ea', boxColor: '#f2f0ea', dashColor: '#f2f0ea', emptyBorder: '#f2f0ea',
    shadow1: SHADOW(4, 4, '#f2f0ea'), shadow2: SHADOW(8, 8, '#f2f0ea'),
    navActiveBg: '#f4be04', navActiveFg: '#000000', focus: '#f4be04',
    chips: chipSet({
      pending: { bg: '#f4be04', bd: '#f2f0ea', fg: '#000000' },
      done: { bg: '#4ade80', bd: '#f2f0ea', fg: '#000000' },
      skip: { bg: '#9aa3b2', bd: '#f2f0ea', fg: '#000000' },
      alert: { bg: '#f87171', bd: '#f2f0ea', fg: '#000000' },
      extra: { bg: '#b7abf5', bd: '#f2f0ea', fg: '#000000' },
      neutral: { bg: '#1a1a1a', bd: '#f2f0ea', fg: '#a89f8f' },
    }),
  },
  light: {
    name: 'light', dark: false, ...CLASSIC_STRUCT,
    surface: '#f7f8fa', surface2: '#ffffff', surface3: '#f0f2f6', hoverFill: '#e3e6ec',
    ink: '#14171f', ink2: '#3d4454', ink3: '#6b7280', line: '#e3e6ec',
    accent: '#3f4dd1', accentFg: '#ffffff', brand: '#3f4dd1', brandFg: '#ffffff',
    pending: '#b45309', done: '#15803d', skip: '#6b7280', alert: '#b91c1c', extra: '#6d28d9',
    elColor: '#e3e6ec', boxColor: '#e3e6ec', dashColor: '#e3e6ec', emptyBorder: null,
    shadow1: NO_SHADOW, shadow2: NO_SHADOW,
    navActiveBg: '#f0f2f6', navActiveFg: '#14171f', focus: '#3f4dd1',
    chips: chipSet({
      pending: { bg: 'transparent', bd: '#b45309', fg: '#b45309' },
      done: { bg: 'transparent', bd: '#15803d', fg: '#15803d' },
      skip: { bg: 'transparent', bd: '#6b7280', fg: '#6b7280' },
      alert: { bg: 'transparent', bd: '#b91c1c', fg: '#b91c1c' },
      extra: { bg: 'transparent', bd: '#6d28d9', fg: '#6d28d9' },
      neutral: { bg: 'transparent', bd: '#e3e6ec', fg: '#6b7280' },
    }),
  },
  dark: {
    name: 'dark', dark: true, ...CLASSIC_STRUCT,
    surface: '#0f1115', surface2: '#161a22', surface3: '#1f2430', hoverFill: '#272d3a',
    ink: '#f2f4f8', ink2: '#c3cad6', ink3: '#8b93a5', line: '#272d3a',
    accent: '#6b76ff', accentFg: '#ffffff', brand: '#6b76ff', brandFg: '#ffffff',
    pending: '#f5a524', done: '#4ade80', skip: '#9aa3b2', alert: '#f87171', extra: '#a78bfa',
    elColor: '#272d3a', boxColor: '#272d3a', dashColor: '#272d3a', emptyBorder: null,
    shadow1: NO_SHADOW, shadow2: NO_SHADOW,
    navActiveBg: '#1f2430', navActiveFg: '#f2f4f8', focus: '#6b76ff',
    chips: chipSet({
      pending: { bg: 'transparent', bd: '#f5a524', fg: '#f5a524' },
      done: { bg: 'transparent', bd: '#4ade80', fg: '#4ade80' },
      skip: { bg: 'transparent', bd: '#9aa3b2', fg: '#9aa3b2' },
      alert: { bg: 'transparent', bd: '#f87171', fg: '#f87171' },
      extra: { bg: 'transparent', bd: '#a78bfa', fg: '#a78bfa' },
      neutral: { bg: 'transparent', bd: '#272d3a', fg: '#8b93a5' },
    }),
  },
};

const ThemeCtx = createContext({ t: PALETTES['brutalist-light'], theme: 'brutalist-light', choice: 'system', setChoice: () => {} });

function resolve(choice, scheme) {
  if (choice === 'system') return scheme === 'dark' ? 'brutalist-dark' : 'brutalist-light';
  return PALETTES[choice] ? choice : 'brutalist-light';
}

export function ThemeProvider({ children }) {
  const scheme = useColorScheme();
  const [choice, setChoiceState] = useState('system');
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((v) => { if (v && THEME_CHOICES.includes(v)) setChoiceState(v); }).catch(() => {});
  }, []);
  const setChoice = (c) => { setChoiceState(c); AsyncStorage.setItem(THEME_KEY, c).catch(() => {}); };
  const value = useMemo(() => {
    const name = resolve(choice, scheme);
    return { t: PALETTES[name], theme: name, choice, setChoice };
  }, [choice, scheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/** Hard offset shadow → RN. iOS uses shadowOffset/opacity; Android elevation
 *  can't do offset hard shadows, so brutalist themes also keep the border. */
export function shadowBox(t, which = 'shadow1') {
  const s = t[which];
  if (!s) return {};
  return {
    shadowColor: s.color, shadowOffset: { width: s.dx, height: s.dy },
    shadowOpacity: 1, shadowRadius: 0, elevation: s.dy,
  };
}
