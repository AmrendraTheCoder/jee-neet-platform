/**
 * Theme context.
 *
 * The scheme follows the OS by default and can be pinned by the student. A pin
 * is stored locally only: a theme preference is not pedagogical telemetry and
 * has no business leaving the device (NFR-PRV-02).
 */

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ColorSchemeName, Palette } from './tokens.js';
import { PALETTES } from './tokens.js';

const STORAGE_KEY = 'theme.preference.v1';

export type ThemePreference = 'system' | ColorSchemeName;

export interface ThemeValue {
  readonly scheme: ColorSchemeName;
  readonly colors: Palette;
  readonly preference: ThemePreference;
  readonly setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const osScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (cancelled) return;
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const scheme: ColorSchemeName =
      preference === 'system' ? (osScheme === 'dark' ? 'dark' : 'light') : preference;
    return {
      scheme,
      colors: PALETTES[scheme],
      preference,
      setPreference: (next) => {
        setPreferenceState(next);
        void AsyncStorage.setItem(STORAGE_KEY, next);
      },
    };
  }, [osScheme, preference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme called outside ThemeProvider');
  }
  return value;
}

/** Convenience for the common case of only wanting colours. */
export function useColors(): Palette {
  return useTheme().colors;
}
