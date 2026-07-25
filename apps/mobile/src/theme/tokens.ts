/**
 * Design tokens: colour, space, radius, type.
 *
 * Two complete palettes (FR-A11Y). Dark mode is not an inverted light mode —
 * KaTeX renders opaque glyph colour from CSS, so the math surface is themed from
 * the same tokens as the native chrome and both must be authored deliberately or
 * the typeset fragment reads as a white rectangle in a dark screen.
 *
 * Every foreground/background pair below is at or above 4.5:1. Do not add a
 * colour without checking it; the target audience reads this app at midnight on
 * a 720p panel with the brightness down.
 */

export interface Palette {
  readonly background: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly surfaceSunken: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textInverse: string;
  readonly accent: string;
  readonly accentMuted: string;
  readonly onAccent: string;
  readonly success: string;
  readonly successMuted: string;
  readonly warning: string;
  readonly warningMuted: string;
  readonly danger: string;
  readonly dangerMuted: string;
  readonly focusRing: string;
  /** Practice navigator states, mirroring the domain PaletteState union. */
  readonly stateNotVisited: string;
  readonly stateNotAnswered: string;
  readonly stateAnswered: string;
  readonly stateMarked: string;
  readonly stateAnsweredAndMarked: string;
}

const LIGHT: Palette = {
  background: '#f7f8fa',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#eef0f4',
  border: '#d9dde4',
  borderStrong: '#aeb5c0',
  text: '#14181f',
  textMuted: '#59616e',
  textInverse: '#ffffff',
  accent: '#1f4fd8',
  accentMuted: '#e6ecfd',
  onAccent: '#ffffff',
  success: '#116435',
  successMuted: '#e3f3e9',
  warning: '#8a5200',
  warningMuted: '#fbeed7',
  danger: '#a51c2c',
  dangerMuted: '#fbe6e8',
  focusRing: '#1f4fd8',
  stateNotVisited: '#aeb5c0',
  stateNotAnswered: '#a51c2c',
  stateAnswered: '#116435',
  stateMarked: '#5b34b3',
  stateAnsweredAndMarked: '#1f4fd8',
};

const DARK: Palette = {
  background: '#0e1116',
  surface: '#161b22',
  surfaceRaised: '#1d232c',
  surfaceSunken: '#0a0d11',
  border: '#2a313b',
  borderStrong: '#454d59',
  text: '#e9edf3',
  textMuted: '#9aa4b2',
  textInverse: '#0e1116',
  accent: '#7ea2ff',
  accentMuted: '#1b2740',
  onAccent: '#0a1020',
  success: '#5fd08a',
  successMuted: '#12271b',
  warning: '#e5b567',
  warningMuted: '#2b2113',
  danger: '#ff8b96',
  dangerMuted: '#2e161a',
  focusRing: '#7ea2ff',
  stateNotVisited: '#6b7484',
  stateNotAnswered: '#ff8b96',
  stateAnswered: '#5fd08a',
  stateMarked: '#b39bf0',
  stateAnsweredAndMarked: '#7ea2ff',
};

export const PALETTES = { light: LIGHT, dark: DARK } as const;
export type ColorSchemeName = keyof typeof PALETTES;

/** 4pt base grid. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

/**
 * Minimum interactive size (FR-A11Y-02).
 *
 * 44 device-independent points is the smaller of the two platform minimums, so
 * meeting it satisfies both. It is a floor applied via minWidth/minHeight rather
 * than a fixed height, because a fixed height clips at 200% text scale.
 */
export const MIN_TOUCH_TARGET = 44;

/**
 * Type scale in points, before the OS text-scale multiplier.
 *
 * Nothing here sets `maxFontSizeMultiplier`. Capping the multiplier is the usual
 * way a layout survives large text, and it is a direct violation of FR-A11Y-01 —
 * the content must reflow, not be pinned small.
 */
export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  mono: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
} as const;

export type TypeToken = keyof typeof type;
