import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

/**
 * Session and capabilities.
 *
 * TWO RULES, BOTH LOAD-BEARING.
 *
 * 1. Roles come from the server-owned `user_roles` table, projected into the
 *    JWT by the access-token hook (FR-IDN-08). They are read here from the
 *    server-controlled claim namespace ONLY. `user_metadata` is writable by
 *    the user; a client that read a role from it would let any student mint
 *    themselves an admin console by editing their own profile. There is no
 *    code path below that touches `user_metadata`, and there must never be.
 *
 * 2. Everything this module returns is presentation. Hiding a button is not
 *    access control. Every destructive capability is re-verified server-side
 *    inside a SECURITY DEFINER RPC against the live database, not against the
 *    cached claim (FR-IDN-10) — so a stale or forged claim buys nothing but a
 *    visible button that fails.
 */

export const CAPABILITIES = [
  'questions.write',
  'questions.approve',
  'tests.publish',
  'keys.revise',
  'attempts.extend',
  'rewards.configure',
  'users.ban',
  'analytics.read',
  'audit.read',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type Role = 'STUDENT' | 'ADMIN' | 'GUARDIAN';

export interface Session {
  readonly userId: string;
  readonly displayName: string;
  readonly orgId: string;
  readonly role: Role;
  readonly capabilities: ReadonlySet<Capability>;
  /** Under-18 principals take a different telemetry and notification path. */
  readonly isMinor: boolean;
}

/** The server-controlled claim namespace. Never `user_metadata`. */
interface ProjectedClaims {
  readonly sub?: unknown;
  readonly org_id?: unknown;
  readonly app_role?: unknown;
  readonly app_capabilities?: unknown;
  readonly display_name?: unknown;
  readonly is_minor?: unknown;
}

function isRole(value: unknown): value is Role {
  return value === 'STUDENT' || value === 'ADMIN' || value === 'GUARDIAN';
}

function readCapabilities(value: unknown): ReadonlySet<Capability> {
  if (!Array.isArray(value)) return new Set();
  const known = new Set<Capability>();
  for (const entry of value) {
    const match = CAPABILITIES.find((c) => c === entry);
    if (match !== undefined) known.add(match);
  }
  return known;
}

/**
 * Decode the payload segment of a JWT for display purposes.
 *
 * This does NOT verify the signature and is not trying to: verification
 * happens at the API boundary on every request. Decoding here only decides
 * which navigation to render.
 */
export function sessionFromAccessToken(token: string): Session | null {
  const segments = token.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || payload === undefined) return null;

  let claims: ProjectedClaims;
  try {
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(normalised)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    claims = JSON.parse(json) as ProjectedClaims;
  } catch {
    return null;
  }

  if (typeof claims.sub !== 'string' || typeof claims.org_id !== 'string') return null;
  if (!isRole(claims.app_role)) return null;

  return {
    userId: claims.sub,
    orgId: claims.org_id,
    role: claims.app_role,
    displayName: typeof claims.display_name === 'string' ? claims.display_name : 'Signed in',
    capabilities: readCapabilities(claims.app_capabilities),
    isMinor: claims.is_minor === true,
  };
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider(props: {
  readonly session: Session | null;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <SessionContext.Provider value={props.session}>{props.children}</SessionContext.Provider>
  );
}

export function useSession(): Session | null {
  return useContext(SessionContext);
}

export function useRequiredSession(): Session {
  const session = useSession();
  if (session === null) throw new Error('this surface requires an authenticated session');
  return session;
}

export function useCapability(capability: Capability): boolean {
  const session = useSession();
  return useMemo(() => session?.capabilities.has(capability) ?? false, [session, capability]);
}
