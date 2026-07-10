import {createContext, useContext, useMemo, useState, type ReactNode} from 'react';
import {useColorScheme} from 'react-native';

import {darkTheme, lightTheme, type Theme} from './tokens';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** The resolved theme (system preference already applied). */
  theme: Theme;
  /** The user's chosen mode — may be 'system'. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Resolves light/dark/system theme, following the OS appearance setting by
 * default (T1.2.1's "theme toggle via system settings"). `setMode` lets
 * Settings (T1.2.8) override to an explicit light/dark choice later.
 */
export function ThemeProvider({children}: {children: ReactNode}) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');

  const value = useMemo<ThemeContextValue>(() => {
    const resolvedScheme = mode === 'system' ? (systemScheme ?? 'light') : mode;
    const theme = resolvedScheme === 'dark' ? darkTheme : lightTheme;
    return {theme, mode, setMode};
  }, [mode, systemScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx.theme;
}

/** Full context access (mode + setter), for the Display settings screen. */
export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useThemeMode must be used within a ThemeProvider');
  }
  return ctx;
}
