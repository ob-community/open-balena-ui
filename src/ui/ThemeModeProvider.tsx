import { PaletteMode, ThemeProvider as MuiThemeProvider, useMediaQuery } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import createCustomTheme from './customTheme';

type ThemePreference = 'system' | 'dark' | 'light';

interface ThemeModeContextValue {
  preference: ThemePreference;
  resolvedMode: PaletteMode;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
  cyclePreference: () => void;
}

const STORAGE_KEY = 'open-balena-ui:themePreference';

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

const readStoredPreference = (): ThemePreference => {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
};

const ThemeModeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)', {
    defaultMatches: true,
    noSsr: true,
  });

  const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  const resolvedMode: PaletteMode = preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;

  const theme = useMemo(() => createCustomTheme(resolvedMode), [resolvedMode]);

  const cyclePreference = useCallback(() => {
    setPreference((current) => {
      switch (current) {
        case 'system':
          return 'dark';
        case 'dark':
          return 'light';
        default:
          return 'system';
      }
    });
  }, []);

  const value = useMemo<ThemeModeContextValue>(
    () => ({
      preference,
      resolvedMode,
      theme,
      setPreference,
      cyclePreference,
    }),
    [preference, resolvedMode, theme, cyclePreference],
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.dataset.colorMode = resolvedMode;
  }, [resolvedMode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <MuiThemeProvider theme={theme}>{children}</MuiThemeProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = (): ThemeModeContextValue => {
  const context = useContext(ThemeModeContext);

  if (!context) {
    throw new Error('useThemeMode must be used within a ThemeModeProvider');
  }

  return context;
};

export type { ThemePreference };
export default ThemeModeProvider;
