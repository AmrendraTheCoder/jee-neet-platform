/**
 * Screen-reader label construction.
 *
 * Every interactive element in this client carries an explicit label. The
 * default — reading the visible child text — fails here more often than it
 * succeeds: a filter chip reads as "Unused 412" with no indication that it is a
 * toggle or that 412 is a matching count, and a mathematical option reads as the
 * raw LaTeX unless the authored spoken-text is used (FR-ITM-12, FR-A11Y-04).
 */

import type { PaletteState } from '@platform/domain';

export function filterChipLabel(args: {
  readonly name: string;
  readonly matchingCount: number;
  readonly selected: boolean;
}): string {
  const state = args.selected ? 'selected' : 'not selected';
  const count =
    args.matchingCount === 1 ? '1 matching question' : `${String(args.matchingCount)} matching questions`;
  return `${args.name} filter, ${state}, ${count}`;
}

const PALETTE_SPOKEN: Readonly<Record<PaletteState, string>> = {
  NOT_VISITED: 'not visited',
  NOT_ANSWERED: 'visited, not answered',
  ANSWERED: 'answered',
  MARKED_FOR_REVIEW: 'marked for review, not answered',
  ANSWERED_AND_MARKED: 'answered and marked for review',
};

export function paletteEntryLabel(displayNumber: number, state: PaletteState): string {
  return `Question ${String(displayNumber)}, ${PALETTE_SPOKEN[state]}`;
}

/**
 * Option label.
 *
 * `spokenText` is the authored accessibility string. Where it is missing the
 * fallback is the plain-text projection, never the LaTeX source — a reader
 * announcing "backslash int sub zero" is a failure, not a degraded experience.
 */
export function optionLabel(args: {
  readonly position: number;
  readonly total: number;
  readonly spokenText: string | null;
  readonly plainText: string;
  readonly selected: boolean;
}): string {
  const body = args.spokenText ?? args.plainText;
  const state = args.selected ? 'selected' : 'not selected';
  return `Option ${String(args.position)} of ${String(args.total)}. ${body}. ${state}`;
}

export function masteryLabel(name: string, masteryPercent: number | null, dueCount: number): string {
  const mastery =
    masteryPercent === null
      ? 'no mastery recorded yet'
      : `mastery ${String(Math.round(masteryPercent))} percent`;
  const due = dueCount === 0 ? 'nothing due for review' : `${String(dueCount)} cards due for review`;
  return `${name}, ${mastery}, ${due}`;
}

/** Pending-sync indicator (FR-SYN-05): one passive string, never a per-answer error. */
export function pendingSyncLabel(pending: number): string {
  if (pending === 0) return 'All work saved';
  if (pending === 1) return '1 answer waiting to sync. Your work is saved on this device.';
  return `${String(pending)} answers waiting to sync. Your work is saved on this device.`;
}
