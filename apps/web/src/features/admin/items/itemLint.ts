import type { AuthoredItem } from '../../../lib/api/types.js';

/**
 * The authoring linter and the publication gate.
 *
 * This is the `author-item` gate from docs/skill.md expressed as code. It is a
 * client-side mirror of server-side enforcement, not a substitute for it — the
 * two-approver rule in particular is a database CHECK constraint (FR-AUT-03)
 * and cannot be satisfied by anything here. What this earns is that an author
 * learns about a problem while writing rather than on submit.
 */

export interface LintFinding {
  readonly code: string;
  readonly severity: 'BLOCK' | 'WARN';
  readonly message: string;
  readonly field: string;
}

/**
 * Phrases whose meaning depends on option POSITION (FR-ITM-11).
 *
 * Shuffling is what breaks these, and it breaks them semantically rather than
 * mechanically: the key is an option UUID so scoring stays correct, and the
 * candidate is left reading "both (A) and (C)" where A and C are now different
 * options. Scoring cannot detect this. The linter is the control.
 */
const ORDER_DEPENDENT_PATTERNS: readonly RegExp[] = [
  /\ball\s+of\s+the\s+above\b/i,
  /\bnone\s+of\s+the\s+above\b/i,
  /\bnone\s+of\s+these\b/i,
  /\bboth\s*\(?[a-d]\)?\s*and\s*\(?[a-d]\)?/i,
  /\bonly\s*\(?[a-d]\)?\b/i,
  /\bboth\s+the\s+above\b/i,
  /\ba\s+and\s+b\s+both\b/i,
];

/** Types whose meaning is positional by construction, never shufflable. */
const NEVER_SHUFFLABLE: ReadonlySet<AuthoredItem['questionType']> = new Set([
  'MATCHING_LIST',
  'ASSERTION_REASON',
]);

export function detectOrderDependentOptions(item: AuthoredItem): readonly string[] {
  const hits: string[] = [];
  for (const option of item.options) {
    if (ORDER_DEPENDENT_PATTERNS.some((pattern) => pattern.test(option.latex))) {
      hits.push(option.latex);
    }
  }
  return hits;
}

export function mustDisableShuffle(item: AuthoredItem): boolean {
  return NEVER_SHUFFLABLE.has(item.questionType) || detectOrderDependentOptions(item).length > 0;
}

/**
 * A rationale that restates the verdict is not a rationale (FR-AUT-04).
 *
 * The check is deliberately crude — length plus a phrase blacklist — because a
 * strict one would be gameable and a loose one is still enough to catch the
 * failure mode the requirement names, which is a field filled in to get past
 * the gate.
 */
const EMPTY_RATIONALE_PATTERNS: readonly RegExp[] = [
  /^this\s+is\s+(in)?correct\.?$/i,
  /^(in)?correct\.?$/i,
  /^wrong\.?$/i,
  /^not\s+the\s+answer\.?$/i,
  /^n\/?a\.?$/i,
];

function rationaleIsSubstantive(rationale: string): boolean {
  const trimmed = rationale.trim();
  if (trimmed.length < 20) return false;
  return !EMPTY_RATIONALE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function lintItem(item: AuthoredItem): readonly LintFinding[] {
  const findings: LintFinding[] = [];

  if (!item.latexValid) {
    findings.push({
      code: 'LATEX_INVALID',
      severity: 'BLOCK',
      field: 'stemLatex',
      message:
        item.latexError ??
        'The server-side LaTeX validator rejected this version. Fix the source; it cannot be bypassed.',
    });
  }

  if (item.provenance === 'THIRD_PARTY_UNCLEARED') {
    findings.push({
      code: 'PROVENANCE_UNCLEARED',
      severity: 'BLOCK',
      field: 'provenance',
      message:
        'Third-party uncleared content cannot be published. Clear the licence or replace the item.',
    });
  }

  if (item.sourceRef.trim() === '') {
    findings.push({
      code: 'SOURCE_REF_MISSING',
      severity: 'BLOCK',
      field: 'sourceRef',
      message: 'Provenance requires a source reference. If you are unsure of the source, the answer is THIRD_PARTY_UNCLEARED, not a guess.',
    });
  }

  if (item.stemLatex.trim() === '') {
    findings.push({
      code: 'STEM_EMPTY',
      severity: 'BLOCK',
      field: 'stemLatex',
      message: 'The question stem is empty.',
    });
  }

  const isNumeric =
    item.questionType === 'NUMERIC_INTEGER' || item.questionType === 'NUMERIC_DECIMAL';

  if (isNumeric) {
    if ((item.numericAnswer ?? '').trim() === '') {
      findings.push({
        code: 'NUMERIC_ANSWER_MISSING',
        severity: 'BLOCK',
        field: 'numericAnswer',
        message: 'A numeric question needs an answer value.',
      });
    }
  } else {
    if (item.options.length < 2) {
      findings.push({
        code: 'TOO_FEW_OPTIONS',
        severity: 'BLOCK',
        field: 'options',
        message: 'At least two options are required.',
      });
    }
    if (!item.options.some((option) => option.isCorrect)) {
      findings.push({
        code: 'NO_CORRECT_OPTION',
        severity: 'BLOCK',
        field: 'options',
        message: 'No option is marked correct.',
      });
    }
    if (item.questionType === 'MCQ_SINGLE' && item.options.filter((o) => o.isCorrect).length > 1) {
      findings.push({
        code: 'MULTIPLE_CORRECT_ON_SINGLE',
        severity: 'BLOCK',
        field: 'options',
        message:
          'This is a single-answer question but more than one option is marked correct. Change the type to multi-correct, or fix the key.',
      });
    }
    for (const [index, option] of item.options.entries()) {
      if (!rationaleIsSubstantive(option.rationale)) {
        findings.push({
          code: 'RATIONALE_MISSING',
          severity: 'BLOCK',
          field: `options.${index}.rationale`,
          message: `Option ${String.fromCharCode(65 + index)} needs a rationale explaining why it is wrong, not a restatement that it is.`,
        });
      }
    }
  }

  const orderDependent = detectOrderDependentOptions(item);
  if (orderDependent.length > 0 && item.shuffleOptions) {
    findings.push({
      code: 'SHUFFLE_UNSAFE',
      severity: 'BLOCK',
      field: 'shuffleOptions',
      message:
        'Option text refers to other options by position ("all of the above", "both (A) and (C)"). Shuffling makes this unanswerable. Shuffling has been turned off.',
    });
  }

  if (NEVER_SHUFFLABLE.has(item.questionType) && item.shuffleOptions) {
    findings.push({
      code: 'TYPE_NOT_SHUFFLABLE',
      severity: 'BLOCK',
      field: 'shuffleOptions',
      message: 'Matching and assertion-reason questions are never shufflable.',
    });
  }

  if (item.altText.trim() === '' || item.spokenText.trim() === '') {
    findings.push({
      code: 'A11Y_TEXT_MISSING',
      severity: 'BLOCK',
      field: 'altText',
      message:
        'Alt text and spoken text are required for every item, not only image-bearing ones. A screen reader reading an integral as "backslash int" is a failure.',
    });
  }

  if (item.subTopicId === null) {
    findings.push({
      code: 'TAXONOMY_MISSING',
      severity: 'BLOCK',
      field: 'subTopicId',
      message: 'Every item must be tagged down to sub-topic. The sub-topic is the review-card key.',
    });
  }

  if (item.authoredDifficulty === null) {
    findings.push({
      code: 'DIFFICULTY_MISSING',
      severity: 'BLOCK',
      field: 'authoredDifficulty',
      message: 'Set your difficulty estimate. It is measured against the empirical value later.',
    });
  }

  if (item.solutionLatex.trim() === '') {
    findings.push({
      code: 'SOLUTION_MISSING',
      severity: 'BLOCK',
      field: 'solutionLatex',
      message: 'Every published item needs a text solution.',
    });
  }

  // Duplicate signals are information, never a block: a variant family is an
  // asset (FR-ITM-13). The gate requires only that they have been looked at.
  if (item.duplicateWarnings.length > 0 && !item.duplicatesAcknowledged) {
    findings.push({
      code: 'DUPLICATES_UNREVIEWED',
      severity: 'WARN',
      field: 'duplicateWarnings',
      message: `${item.duplicateWarnings.length} near-duplicate item${item.duplicateWarnings.length === 1 ? '' : 's'} found. Review and acknowledge. Two members of one variant family must never land in the same paper.`,
    });
  }

  if (item.attemptCount > 0) {
    findings.push({
      code: 'HAS_ATTEMPTS',
      severity: 'WARN',
      field: 'versionNo',
      message: `${item.attemptCount} attempts exist against this item. Saving a content change forks a new version; students who sat it before and after answered materially different questions.`,
    });
  }

  return findings;
}

export interface GateStatus {
  readonly ready: boolean;
  readonly blocking: readonly LintFinding[];
  readonly warnings: readonly LintFinding[];
  readonly needsSecondApprover: boolean;
}

/**
 * Whether this version may publish.
 *
 * `approved_by <> created_by` is checked here for the operator's benefit and
 * enforced as a database CHECK constraint regardless (FR-AUT-03). You cannot
 * approve your own item even with super-admin rights, and no console state
 * changes that.
 */
export function evaluateGate(item: AuthoredItem, currentUserId: string): GateStatus {
  const findings = lintItem(item);
  const blocking = findings.filter((f) => f.severity === 'BLOCK');
  const needsSecondApprover = item.approvedBy === null || item.approvedBy === item.createdBy;

  return {
    ready: blocking.length === 0 && !needsSecondApprover && currentUserId !== item.createdBy,
    blocking,
    warnings: findings.filter((f) => f.severity === 'WARN'),
    needsSecondApprover,
  };
}
