import { useEffect, useState } from 'react';

/**
 * Presentation preferences, honoured rather than overridden (FR-A11Y-03).
 *
 * The reduce-motion signal is read here as well as in CSS because a few
 * behaviours are not stylable: the palette does not smooth-scroll the current
 * question into view, and the pending-sync indicator does not animate, when the
 * candidate has asked for reduced motion.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** Drives the two-column player collapsing to a single column with a drawer. */
export function useIsNarrow(): boolean {
  return useMediaQuery('(max-width: 60rem)');
}

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'platform.theme';

function readStoredTheme(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Explicit theme choice, stamped on the root element.
 *
 * `system` removes the attribute entirely so the OS media query resumes
 * control. Writing `data-theme="light"` for the system case would pin a
 * candidate who changes their device to dark mode mid-paper into a bright
 * screen, which is a real complaint in an evening examination window.
 */
export function useThemePreference(): readonly [ThemePreference, (next: ThemePreference) => void] {
  const [theme, setTheme] = useState<ThemePreference>(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return [theme, setTheme] as const;
}

/**
 * Fires when the tab returns to the foreground.
 *
 * The attempt player forces a clock reconcile here: some platforms suspend the
 * monotonic clock while a tab is hidden, so a candidate returning from a
 * backgrounded tab must be re-anchored against the server before the countdown
 * is trusted again (FR-ATT-07).
 */
export function useOnForeground(handler: () => void): void {
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') handler();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', handler);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', handler);
    };
  }, [handler]);
}
