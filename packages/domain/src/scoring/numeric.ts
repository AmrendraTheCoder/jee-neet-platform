/**
 * Normalisation and grading of numeric (non-MCQ) responses.
 *
 * Requirements: FR-SCR-05, FR-SCR-06. Edge case: EC-DATA-07.
 *
 * The failure this module exists to prevent: a student on a Hindi or Tamil
 * device locale types a correct answer, the keypad emits non-ASCII decimal
 * digits, `parseFloat` returns NaN, and the answer scores zero. The student
 * has no way to discover why. Exam-grade grading cannot use string equality
 * and cannot use `parseFloat`.
 */

import {
  type Decimal,
  type RoundingMode,
  absDiff,
  compareDecimal,
  decimalFromString,
  equalsDecimal,
  parseDecimal,
  roundDecimal,
} from './decimal.js';

/**
 * Base code points of the Unicode decimal digit blocks a candidate in India
 * may plausibly produce. NEET is offered in 13 languages; a device locale set
 * to any of them can surface a native-numeral keypad.
 *
 * NFKC does *not* fold these to ASCII — a common and expensive assumption.
 */
const DIGIT_BASES: readonly number[] = [
  0x0030, // ASCII
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic
  0x0966, // Devanagari
  0x09e6, // Bengali / Assamese
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Odia
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0xff10, // Fullwidth
];

const DIGIT_MAP: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const base of DIGIT_BASES) {
    for (let d = 0; d < 10; d += 1) {
      m.set(String.fromCodePoint(base + d), String(d));
    }
  }
  return m;
})();

/** Every dash-like code point a keyboard, autocorrect or paste can produce. */
const MINUS_VARIANTS = new Set([
  '−', // MINUS SIGN
  '‐', // HYPHEN
  '‑', // NON-BREAKING HYPHEN
  '‒', // FIGURE DASH
  '–', // EN DASH
  '—', // EM DASH
  '―', // HORIZONTAL BAR
  '﹘', // SMALL EM DASH
  '﹣', // SMALL HYPHEN-MINUS
  '－', // FULLWIDTH HYPHEN-MINUS
]);

const PLUS_VARIANTS = new Set(['＋', '﹢']);

/**
 * Characters removed outright.
 *
 * The comma is a *thousands* separator here, not a decimal separator. Indian
 * numeric convention uses the period for decimals universally, and the lakh
 * grouping (1,00,000) is common. Treating comma as a decimal separator would
 * misread `1,50,000` catastrophically.
 */
const STRIPPED = new Set([
  ',',
  '٬', // ARABIC THOUSANDS SEPARATOR
  ' ', // THIN SPACE
  ' ', // NARROW NO-BREAK SPACE
  ' ', // NO-BREAK SPACE
  ' ', // FIGURE SPACE
  "'",
  '’', // RIGHT SINGLE QUOTATION MARK, used as a separator in some locales
  '_',
]);

/** Decimal separators folded to `.` */
const DECIMAL_SEPARATORS = new Set(['٫', '·', '．']);

export interface NormalizedNumeric {
  /** Exactly what the student typed, preserved for audit and dispute (FR-SCR-05). */
  readonly raw: string;
  /** ASCII canonical form, or null if the input could not be canonicalised. */
  readonly canonical: string | null;
}

/**
 * Fold a raw numeric response to an ASCII canonical form.
 *
 * Never throws. A null canonical means "the student typed something, but it is
 * not a number" — which is a wrong answer, not an unattempted one.
 */
export function normalizeNumericInput(raw: string): NormalizedNumeric {
  if (raw === '') return { raw, canonical: null };

  const nfkc = raw.normalize('NFKC');
  let out = '';

  for (const ch of nfkc) {
    if (STRIPPED.has(ch)) continue;
    if (/\s/u.test(ch)) continue;
    if (MINUS_VARIANTS.has(ch)) {
      out += '-';
      continue;
    }
    if (PLUS_VARIANTS.has(ch)) {
      out += '+';
      continue;
    }
    if (DECIMAL_SEPARATORS.has(ch)) {
      out += '.';
      continue;
    }
    const digit = DIGIT_MAP.get(ch);
    out += digit ?? ch;
  }

  if (parseDecimal(out) === null) return { raw, canonical: null };
  return { raw, canonical: out };
}

/**
 * How a numeric answer is compared to the key. Authored per question as data
 * (FR-SCR-06) because examining bodies differ, and the difference is worth
 * marks.
 */
export type NumericSpec =
  | { readonly kind: 'EXACT_INTEGER' }
  | { readonly kind: 'TOLERANCE'; readonly toleranceAbs: string }
  | { readonly kind: 'ROUNDED'; readonly decimals: number; readonly mode: RoundingMode };

export type NumericVerdict = 'CORRECT' | 'INCORRECT' | 'UNPARSEABLE';

/**
 * Grade a numeric response against a key value.
 *
 * Pure: no clock, no configuration, no I/O. Callers supply everything.
 */
export function gradeNumeric(
  studentRaw: string | null,
  keyValue: string,
  spec: NumericSpec,
): NumericVerdict {
  if (studentRaw === null || studentRaw.trim() === '') return 'INCORRECT';

  const { canonical } = normalizeNumericInput(studentRaw);
  if (canonical === null) return 'UNPARSEABLE';

  const student = parseDecimal(canonical);
  if (student === null) return 'UNPARSEABLE';

  const key = decimalFromString(keyValue);

  switch (spec.kind) {
    case 'EXACT_INTEGER': {
      // Integer-answer questions: the student may legitimately type "12.00".
      // Compare at integer precision rather than demanding a literal match.
      const s = roundDecimal(student, 0, 'TRUNCATE');
      const k = roundDecimal(key, 0, 'TRUNCATE');
      // A fractional student answer to an integer question is wrong, not
      // silently truncated into correctness.
      if (!equalsDecimal(student, s)) return 'INCORRECT';
      return equalsDecimal(s, k) ? 'CORRECT' : 'INCORRECT';
    }
    case 'TOLERANCE': {
      const tol = decimalFromString(spec.toleranceAbs);
      const diff = absDiff(student, key);
      return compareDecimal(diff, tol) <= 0 ? 'CORRECT' : 'INCORRECT';
    }
    case 'ROUNDED': {
      const s = roundDecimal(student, spec.decimals, spec.mode);
      const k = roundDecimal(key, spec.decimals, spec.mode);
      return equalsDecimal(s, k) ? 'CORRECT' : 'INCORRECT';
    }
  }
}

export type { Decimal, RoundingMode };
