import { describe, expect, it } from 'vitest';
import { gradeNumeric, normalizeNumericInput } from '../src/scoring/numeric.js';
import {
  compareDecimal,
  decimalFromString,
  decimalToString,
  parseDecimal,
  roundDecimal,
} from '../src/scoring/decimal.js';

/**
 * AC-SCR-02 — the pathological numeric fixture set, run as a CI gate.
 *
 * Every case here corresponds to a real way a candidate can type a correct
 * answer and have it marked wrong by a naive implementation.
 */

describe('decimal — exact arithmetic', () => {
  it('parses integers, decimals, signs and exponents', () => {
    expect(decimalToString(decimalFromString('42'))).toBe('42');
    expect(decimalToString(decimalFromString('-3.140'))).toBe('-3.140');
    expect(decimalToString(decimalFromString('+0.5'))).toBe('0.5');
    expect(decimalToString(decimalFromString('2.0e0'))).toBe('2.0');
    expect(decimalToString(decimalFromString('1.5e2'))).toBe('150');
    expect(decimalToString(decimalFromString('15e-1'))).toBe('1.5');
  });

  it('treats trailing zeros as equal in value but preserves them in form', () => {
    const a = decimalFromString('2.50');
    const b = decimalFromString('2.5');
    expect(compareDecimal(a, b)).toBe(0);
    expect(decimalToString(a)).toBe('2.50');
    expect(decimalToString(b)).toBe('2.5');
  });

  it('does not lose precision the way IEEE-754 does', () => {
    // The canonical float failure: 0.1 + 0.2 !== 0.3
    expect(0.1 + 0.2).not.toBe(0.3);
    const sum = decimalFromString('0.30000000000000004');
    const exact = decimalFromString('0.3');
    // Exact arithmetic sees these as different, which is the correct answer.
    expect(compareDecimal(sum, exact)).toBe(1);
  });

  it('normalises negative zero so equality is total', () => {
    expect(decimalToString(decimalFromString('-0'))).toBe('0');
    expect(decimalToString(decimalFromString('-0.00'))).toBe('0.00');
  });

  it('rejects malformed input rather than guessing', () => {
    for (const bad of ['', '.', '-', 'abc', '1.2.3', '1/2', '--1', '1e', 'e5', '1,5,0']) {
      expect(parseDecimal(bad), `expected ${JSON.stringify(bad)} to be unparseable`).toBeNull();
    }
  });

  it('truncates and rounds differently, as published schemes require', () => {
    const v = decimalFromString('2.567');
    expect(decimalToString(roundDecimal(v, 2, 'TRUNCATE'))).toBe('2.56');
    expect(decimalToString(roundDecimal(v, 2, 'HALF_UP'))).toBe('2.57');

    // The boundary case that separates the two modes.
    const b = decimalFromString('2.565');
    expect(decimalToString(roundDecimal(b, 2, 'TRUNCATE'))).toBe('2.56');
    expect(decimalToString(roundDecimal(b, 2, 'HALF_UP'))).toBe('2.57');
  });

  it('rounds magnitude away from zero for negatives', () => {
    expect(decimalToString(roundDecimal(decimalFromString('-2.5'), 0, 'HALF_UP'))).toBe('-3');
    expect(decimalToString(roundDecimal(decimalFromString('-2.5'), 0, 'TRUNCATE'))).toBe('-2');
  });
});

describe('normalizeNumericInput', () => {
  const cases: readonly (readonly [string, string | null, string])[] = [
    ['42', '42', 'plain ASCII'],
    ['  42  ', '42', 'surrounding whitespace'],
    ['2.50', '2.50', 'trailing zero preserved in canonical form'],
    ['−3', '-3', 'U+2212 MINUS SIGN'],
    ['–3', '-3', 'U+2013 EN DASH'],
    ['—3', '-3', 'U+2014 EM DASH'],
    ['‐3', '-3', 'U+2010 HYPHEN'],
    ['－3', '-3', 'fullwidth hyphen-minus'],
    ['१२', '12', 'Devanagari digits'],
    ['४२.५', '42.5', 'Devanagari with decimal point'],
    ['௧௨௩', '123', 'Tamil digits'],
    ['১২৩', '123', 'Bengali digits'],
    ['١٢٣', '123', 'Arabic-Indic digits'],
    ['೧೨೩', '123', 'Kannada digits'],
    ['൧൨൩', '123', 'Malayalam digits'],
    ['１２３', '123', 'fullwidth digits'],
    ['1,50,000', '150000', 'Indian lakh grouping'],
    ['1,000', '1000', 'Western thousands grouping'],
    ['1 000', '1000', 'no-break space as separator'],
    ['12٫5', '12.5', 'Arabic decimal separator'],
    ['2.0e0', '2.0e0', 'scientific notation preserved for the parser'],
    ['abc', null, 'not a number'],
    ['1/2', null, 'fraction is not accepted'],
    ['', null, 'empty'],
    ['1.2.3', null, 'two decimal points'],
  ];

  for (const [input, expected, label] of cases) {
    it(`${label}: ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(normalizeNumericInput(input).canonical).toBe(expected);
    });
  }

  it('always preserves the raw response verbatim for audit', () => {
    const raw = '  ४२.५०  ';
    const result = normalizeNumericInput(raw);
    expect(result.raw).toBe(raw);
    expect(result.canonical).toBe('42.50');
  });
});

describe('gradeNumeric — EXACT_INTEGER', () => {
  const spec = { kind: 'EXACT_INTEGER' } as const;

  it('accepts an integer typed with redundant decimal zeros', () => {
    expect(gradeNumeric('12', '12', spec)).toBe('CORRECT');
    expect(gradeNumeric('12.0', '12', spec)).toBe('CORRECT');
    expect(gradeNumeric('12.00', '12', spec)).toBe('CORRECT');
  });

  it('accepts an integer typed in a non-ASCII numeral system', () => {
    expect(gradeNumeric('१२', '12', spec)).toBe('CORRECT');
    expect(gradeNumeric('௧௨', '12', spec)).toBe('CORRECT');
  });

  it('does not silently truncate a fractional answer into correctness', () => {
    expect(gradeNumeric('12.4', '12', spec)).toBe('INCORRECT');
  });

  it('handles negative integers with any dash variant', () => {
    expect(gradeNumeric('-5', '-5', spec)).toBe('CORRECT');
    expect(gradeNumeric('−5', '-5', spec)).toBe('CORRECT');
  });

  it('reports unparseable separately from incorrect', () => {
    expect(gradeNumeric('twelve', '12', spec)).toBe('UNPARSEABLE');
    expect(gradeNumeric('1/2', '12', spec)).toBe('UNPARSEABLE');
  });

  it('treats a blank response as incorrect, not unparseable', () => {
    expect(gradeNumeric(null, '12', spec)).toBe('INCORRECT');
    expect(gradeNumeric('   ', '12', spec)).toBe('INCORRECT');
  });
});

describe('gradeNumeric — TOLERANCE', () => {
  const spec = { kind: 'TOLERANCE', toleranceAbs: '0.01' } as const;

  it('accepts values inside the band, inclusive of the boundary', () => {
    expect(gradeNumeric('2.5', '2.5', spec)).toBe('CORRECT');
    expect(gradeNumeric('2.51', '2.5', spec)).toBe('CORRECT');
    expect(gradeNumeric('2.49', '2.5', spec)).toBe('CORRECT');
  });

  it('rejects values outside the band', () => {
    expect(gradeNumeric('2.52', '2.5', spec)).toBe('INCORRECT');
    expect(gradeNumeric('2.48', '2.5', spec)).toBe('INCORRECT');
  });

  it('is exact at the boundary where float arithmetic is not', () => {
    // 0.3 - 0.29 in IEEE-754 is 0.010000000000000009, which a float
    // implementation would reject against a 0.01 tolerance. It must be accepted.
    expect(gradeNumeric('0.29', '0.3', spec)).toBe('CORRECT');
  });
});

describe('gradeNumeric — ROUNDED', () => {
  it('truncates to two decimals where the scheme says truncate', () => {
    const spec = { kind: 'ROUNDED', decimals: 2, mode: 'TRUNCATE' } as const;
    expect(gradeNumeric('2.567', '2.56', spec)).toBe('CORRECT');
    expect(gradeNumeric('2.569', '2.56', spec)).toBe('CORRECT');
    expect(gradeNumeric('2.57', '2.56', spec)).toBe('INCORRECT');
  });

  it('rounds where the scheme says round, giving a different verdict', () => {
    const truncate = { kind: 'ROUNDED', decimals: 2, mode: 'TRUNCATE' } as const;
    const halfUp = { kind: 'ROUNDED', decimals: 2, mode: 'HALF_UP' } as const;
    // The same student input, the same key, opposite verdicts. This is exactly
    // why the mode is authored per question rather than assumed.
    expect(gradeNumeric('2.567', '2.57', truncate)).toBe('INCORRECT');
    expect(gradeNumeric('2.567', '2.57', halfUp)).toBe('CORRECT');
  });
});
