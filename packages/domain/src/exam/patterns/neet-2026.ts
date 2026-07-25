import type { ExamPattern, PatternSection } from '../pattern.js';
import type { Subject } from '../../types.js';

/**
 * NEET (UG) 2026.
 *
 * PROVENANCE STATUS: UNVERIFIED. The structural facts below were reported as
 * confirmed against the primary Information Bulletin during the research pass
 * (180 questions, 720 marks, 180 minutes, +4/-1, four subjects at 45 questions
 * each), but nobody on this team has retrieved that document directly. Retrieve
 * it, confirm, set `status: 'VERIFIED_PRIMARY'` and record `retrievedOn`.
 *
 * OPEN POINT 1 — Section A / Section B structure.
 *   A previous cycle split each subject into Section A (35 compulsory) and
 *   Section B (15 offered, 10 answered), and that split was subsequently
 *   reverted to a flat 45. This file encodes the flat 45. If the split is in
 *   force, express it as two sections with requiredCount 35 and 10 — the shape
 *   already supports internal choice, no code change is needed.
 *
 * OPEN POINT 2 — PwD accommodations.
 *   The bulletin provides a compensatory hour and pro-rata additional time for
 *   candidates with disability. That is an entitlement attached to a *person*,
 *   not to this pattern (FR-A11Y-05), and is handled by the attempt layer.
 *   It is noted here so the 180-minute figure is not mistaken for universal.
 */

const BIOLOGY: readonly Subject[] = ['BOTANY', 'ZOOLOGY'];
const PHYSICAL: readonly Subject[] = ['PHYSICS', 'CHEMISTRY'];
const ALL: readonly Subject[] = [...PHYSICAL, ...BIOLOGY];

function sectionFor(subject: Subject, ordinal: number): PatternSection {
  return {
    ordinal,
    name: titleCase(subject),
    subject,
    questionType: 'MCQ_SINGLE',
    questionCount: 45,
    requiredCount: 45,
    maxMarks: 180,
    durationSeconds: null,
    marking: {
      questionType: 'MCQ_SINGLE',
      correct: 4,
      incorrect: -1,
      unattempted: 0,
    },
  };
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export const NEET_2026: ExamPattern = {
  id: 'NEET-2026-UG',
  exam: 'NEET',
  year: 2026,
  paper: 'NEET (UG)',
  durationMinutes: 180,
  totalMarks: 720,
  sections: ALL.map((s, i) => sectionFor(s, i + 1)),
  // Published chain leads with Biology (Botany + Zoology combined), then
  // Chemistry, then Physics, then fewer incorrect responses.
  tieBreak: [
    { kind: 'TOTAL_SCORE_DESC' },
    { kind: 'SUBJECT_GROUP_SCORE_DESC', subjects: BIOLOGY },
    { kind: 'SUBJECT_SCORE_DESC', subject: 'CHEMISTRY' },
    { kind: 'SUBJECT_SCORE_DESC', subject: 'PHYSICS' },
    { kind: 'FEWER_INCORRECT' },
    { kind: 'EARLIER_SUBMISSION' },
    { kind: 'STABLE_ID' },
  ],
  provenance: {
    sourceUrl: 'https://neet.nta.nic.in/',
    sourceLabel: 'NTA NEET (UG) 2026 Information Bulletin',
    retrievedOn: null,
    status: 'UNVERIFIED',
    notes:
      'Reported confirmed during research (180Q / 720 marks / 180 min / +4 / -1) but not retrieved first-hand. Section A/B split status is the open question.',
  },
};
