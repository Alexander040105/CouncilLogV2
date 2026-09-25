import { createContext, useContext, useEffect, useState } from 'react';

const KEY = 'councilog.theme';
export const THEMES = [
  { id: 'brutalist-light', label: 'Neo-brutalist' },
  { id: 'brutalist-dark', label: 'Neo-brutalist dark' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];
const ThemeCtx = createContext({ theme: 'brutalist-light', setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(
    () => document.documentElement.dataset.theme || 'brutalist-light'
  );

  const setTheme = (t) => {
    localStorage.setItem(KEY, t);
    document.documentElement.dataset.theme = t;
    setThemeState(t);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
