import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * A hand-rolled router, roughly 120 lines.
 *
 * Both surfaces here are behind authentication and have fewer than twenty
 * routes between them. A routing framework would add a dependency, a build
 * step and a code-splitting model to solve a problem this app does not have.
 * What it must do well is refuse to navigate away from a live attempt, which
 * is a five-line guard here and a framework-specific dance elsewhere.
 */

export interface RouteMatch {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
}

interface RouterValue {
  readonly location: string;
  navigate(to: string, options?: { readonly replace?: boolean }): void;
  /**
   * Registers a predicate that can block navigation. Used by the attempt
   * player: leaving a live paper by an in-app link must be deliberate, because
   * the deadline keeps running (FR-ATT-09 — a ranked attempt cannot be paused).
   */
  setNavigationGuard(guard: ((to: string) => boolean) | null): void;
}

const RouterContext = createContext<RouterValue | null>(null);

function currentPath(): string {
  return window.location.pathname + window.location.search;
}

export function RouterProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const [location, setLocation] = useState(currentPath);
  const [guard, setGuardState] = useState<((to: string) => boolean) | null>(null);

  useEffect(() => {
    const onPop = (): void => setLocation(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback(
    (to: string, options?: { readonly replace?: boolean }) => {
      if (guard !== null && !guard(to)) return;
      if (options?.replace === true) window.history.replaceState(null, '', to);
      else window.history.pushState(null, '', to);
      setLocation(to);
    },
    [guard],
  );

  const setNavigationGuard = useCallback((next: ((to: string) => boolean) | null) => {
    // Stored via the functional form: a bare setState would call the guard.
    setGuardState(() => next);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ location, navigate, setNavigationGuard }),
    [location, navigate, setNavigationGuard],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (value === null) throw new Error('useRouter used outside RouterProvider');
  return value;
}

/**
 * Match `/attempt/:attemptId/review` style patterns. Returns null on no match.
 * A trailing `/*` segment matches the remainder and exposes it as `rest`.
 */
export function matchPath(pattern: string, location: string): RouteMatch | null {
  const [rawPath = '', rawQuery = ''] = location.split('?');
  const patternParts = pattern.split('/').filter((p) => p !== '');
  const pathParts = rawPath.split('/').filter((p) => p !== '');

  const params: Record<string, string> = {};
  const wildcard = patternParts.at(-1) === '*';

  if (!wildcard && patternParts.length !== pathParts.length) return null;
  if (wildcard && pathParts.length < patternParts.length - 1) return null;

  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    if (expected === undefined) return null;
    if (expected === '*') {
      params['rest'] = pathParts.slice(i).join('/');
      break;
    }
    const actual = pathParts[i];
    if (actual === undefined) return null;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }

  return { path: rawPath, params, query: new URLSearchParams(rawQuery) };
}

export function useRouteMatch(pattern: string): RouteMatch | null {
  const { location } = useRouter();
  return useMemo(() => matchPath(pattern, location), [pattern, location]);
}

export function Link(props: {
  readonly to: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly replace?: boolean;
}): JSX.Element {
  const { navigate } = useRouter();
  const { to, children, className, replace } = props;
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        // Preserve modifier-clicks so "open in new tab" still works.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to, replace === true ? { replace: true } : undefined);
      }}
    >
      {children}
    </a>
  );
}

/** Installs a navigation guard for the lifetime of the calling component. */
export function useNavigationGuard(guard: ((to: string) => boolean) | null): void {
  const { setNavigationGuard } = useRouter();
  useEffect(() => {
    setNavigationGuard(guard);
    return () => setNavigationGuard(null);
  }, [guard, setNavigationGuard]);
}
