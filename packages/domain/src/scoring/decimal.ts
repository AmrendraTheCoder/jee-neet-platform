/**
 * Exact fixed-point decimal arithmetic backed by BigInt.
 *
 * Why not `number` (FR-SCR-05, EC-DATA-07): IEEE-754 cannot represent 0.1
 * exactly, so `0.1 + 0.2 !== 0.3`. A numeric answer graded with float
 * comparison marks correct answers wrong at tolerance boundaries, silently,
 * and it looks like poor student performance. This module is deliberately
 * dependency-free so the scoring path has no supply-chain surface.
 *
 * Representation: value = (neg ? -1 : 1) * units / 10^scale
 */

export interface Decimal {
  readonly neg: boolean;
  readonly units: bigint;
  readonly scale: number;
}

const DIGITS = /^[0-9]+$/;

export function makeDecimal(neg: boolean, units: bigint, scale: number): Decimal {
  // Normalise negative zero to positive zero so equality is total.
  if (units === 0n) return { neg: false, units: 0n, scale };
  return { neg, units, scale };
}

/**
 * Parse a *pre-normalised* numeric string (see `normalizeNumericInput`).
 * Accepts an optional sign, digits, an optional fractional part, and an
 * optional decimal exponent. Returns null for anything else — a present but
 * unparseable response is a wrong answer, not an unattempted one.
 */
export function parseDecimal(input: string): Decimal | null {
  let s = input.trim();
  if (s === '') return null;

  let neg = false;
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  if (s === '') return null;

  let exponent = 0;
  const eIndex = s.search(/[eE]/);
  if (eIndex !== -1) {
    const expPart = s.slice(eIndex + 1);
    s = s.slice(0, eIndex);
    let expNeg = false;
    let expDigits = expPart;
    if (expDigits.startsWith('+')) expDigits = expDigits.slice(1);
    else if (expDigits.startsWith('-')) {
      expNeg = true;
      expDigits = expDigits.slice(1);
    }
    if (!DIGITS.test(expDigits)) return null;
    // Guard against absurd exponents that would allocate unbounded BigInts.
    if (expDigits.length > 4) return null;
    exponent = (expNeg ? -1 : 1) * Number(expDigits);
  }

  const dotIndex = s.indexOf('.');
  let intPart: string;
  let fracPart: string;
  if (dotIndex === -1) {
    intPart = s;
    fracPart = '';
  } else {
    intPart = s.slice(0, dotIndex);
    fracPart = s.slice(dotIndex + 1);
    if (s.indexOf('.', dotIndex + 1) !== -1) return null; // more than one dot
  }

  if (intPart === '' && fracPart === '') return null;
  if (intPart !== '' && !DIGITS.test(intPart)) return null;
  if (fracPart !== '' && !DIGITS.test(fracPart)) return null;

  const units = BigInt((intPart === '' ? '0' : intPart) + fracPart);
  let scale = fracPart.length - exponent;

  if (scale < 0) {
    // Negative scale means the exponent shifted left of the decimal point.
    if (-scale > 6000) return null;
    return makeDecimal(neg, units * 10n ** BigInt(-scale), 0);
  }
  if (scale > 6000) return null;
  return makeDecimal(neg, units, scale);
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Re-express both operands at a common scale. */
function align(a: Decimal, b: Decimal): { scale: number; au: bigint; bu: bigint } {
  const scale = Math.max(a.scale, b.scale);
  return {
    scale,
    au: a.units * pow10(scale - a.scale),
    bu: b.units * pow10(scale - b.scale),
  };
}

function signed(d: Decimal, units: bigint): bigint {
  return d.neg ? -units : units;
}

/** Returns -1, 0 or 1. */
export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const { au, bu } = align(a, b);
  const av = signed(a, au);
  const bv = signed(b, bu);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

export function equalsDecimal(a: Decimal, b: Decimal): boolean {
  return compareDecimal(a, b) === 0;
}

/** |a - b| */
export function absDiff(a: Decimal, b: Decimal): Decimal {
  const { scale, au, bu } = align(a, b);
  const diff = signed(a, au) - signed(b, bu);
  const mag = diff < 0n ? -diff : diff;
  return makeDecimal(false, mag, scale);
}

export type RoundingMode = 'HALF_UP' | 'TRUNCATE';

/**
 * Round or truncate to `decimals` places.
 *
 * Both modes exist because examining bodies differ: some specify rounding to
 * the nearest integer, others specify truncation to two decimal places. The
 * mode is authored per question as data, never assumed (FR-SCR-06).
 */
export function roundDecimal(d: Decimal, decimals: number, mode: RoundingMode): Decimal {
  if (decimals < 0) throw new RangeError('decimals must be >= 0');
  if (d.scale <= decimals) {
    return makeDecimal(d.neg, d.units * pow10(decimals - d.scale), decimals);
  }
  const drop = d.scale - decimals;
  const divisor = pow10(drop);
  const quotient = d.units / divisor;
  if (mode === 'TRUNCATE') {
    return makeDecimal(d.neg, quotient, decimals);
  }
  const remainder = d.units % divisor;
  // HALF_UP on magnitude: 2.5 -> 3, -2.5 -> -3.
  const roundUp = remainder * 2n >= divisor;
  return makeDecimal(d.neg, roundUp ? quotient + 1n : quotient, decimals);
}

export function decimalToString(d: Decimal): string {
  const raw = d.units.toString().padStart(d.scale + 1, '0');
  const cut = raw.length - d.scale;
  const intPart = raw.slice(0, cut);
  const fracPart = raw.slice(cut);
  const body = d.scale === 0 ? intPart : `${intPart}.${fracPart}`;
  return d.neg ? `-${body}` : body;
}

export function decimalFromString(s: string): Decimal {
  const parsed = parseDecimal(s);
  if (parsed === null) throw new TypeError(`not a decimal literal: ${JSON.stringify(s)}`);
  return parsed;
}
