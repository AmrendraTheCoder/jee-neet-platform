/**
 * The one-WebView-per-screen guarantee, made structural (FR-MTH-05).
 *
 * A WebView is measured in production at 150-200 MB, and the 2026 India baseline
 * device has 4 GB of RAM shared with a Hermes heap that grew ~25% in the current
 * runtime. Five live WebViews will be killed by the OS mid-session. The failure
 * is not gradual: the app disappears.
 *
 * The rule is therefore enforced rather than documented. Every `MathSurface`
 * claims this registry on mount; a second concurrent claim throws in development
 * and is reported in production. It is deliberately loud, because the mistake it
 * catches — a `MathSurface` inside a list row — looks completely fine on a
 * developer's device and only fails on the hardware the students actually own.
 */

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { PixelRatio } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider.js';
import { type as typeScale } from '../../theme/tokens.js';
import type { MathHostTheme } from './protocol.js';

export class DuplicateMathSurfaceError extends Error {
  constructor(existingOwner: string, attemptedOwner: string) {
    super(
      `A math WebView is already mounted by "${existingOwner}"; "${attemptedOwner}" tried to mount a second one on the same screen. ` +
        'One WebView per screen is a hard budget (FR-MTH-05). Render list rows with NativeProse and the pre-rendered plain text instead.',
    );
    this.name = 'DuplicateMathSurfaceError';
  }
}

export interface MathHostValue {
  readonly theme: MathHostTheme;
  readonly claim: (owner: string) => void;
  readonly release: (owner: string) => void;
}

const MathHostContext = createContext<MathHostValue | null>(null);

export function MathHostProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const { colors } = useTheme();
  const owner = useRef<string | null>(null);

  const claim = useCallback((next: string) => {
    if (owner.current !== null && owner.current !== next) {
      throw new DuplicateMathSurfaceError(owner.current, next);
    }
    owner.current = next;
  }, []);

  const release = useCallback((next: string) => {
    if (owner.current === next) owner.current = null;
  }, []);

  const theme = useMemo<MathHostTheme>(() => {
    // The OS text-scale multiplier is applied to the WebView's root font size so
    // typeset mathematics grows with the rest of the interface. Without this the
    // stem scales to 200% and the equation inside it does not, which is worse
    // than not scaling at all (FR-A11Y-01).
    const scaledFontSize = typeScale.body.fontSize * PixelRatio.getFontScale();
    return {
      bg: colors.surface,
      surface: colors.surface,
      text: colors.text,
      muted: colors.textMuted,
      border: colors.border,
      accent: colors.accent,
      'accent-muted': colors.accentMuted,
      danger: colors.danger,
      'danger-muted': colors.dangerMuted,
      'font-size': `${String(Math.round(scaledFontSize))}px`,
    };
  }, [colors]);

  const value = useMemo<MathHostValue>(() => ({ theme, claim, release }), [theme, claim, release]);

  return <MathHostContext.Provider value={value}>{children}</MathHostContext.Provider>;
}

export function useMathHost(): MathHostValue {
  const value = useContext(MathHostContext);
  if (value === null) {
    throw new Error(
      'useMathHost called outside MathHostProvider. Wrap the screen, not the row — the provider is what makes the single-WebView budget checkable.',
    );
  }
  return value;
}
