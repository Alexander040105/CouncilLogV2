import { createContext, useContext, useEffect, useState } from 'react';

const KEY = 'councilog.theme';
const ThemeCtx = createContext({ theme: 'dark', setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(
    () => document.documentElement.dataset.theme || 'dark'
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
