import type { ExamPattern, PatternSection } from '../pattern.js';
import type { Subject } from '../../types.js';

/**
 * JEE Main 2026, Paper 1 (B.E./B.Tech).
 *
 * PROVENANCE STATUS: UNVERIFIED. `assertRankable` will refuse this pattern for
 * any ranked assessment until someone retrieves the primary Information
 * Bulletin from nta.ac.in / jeemain.nta.nic.in, confirms the two open points
 * below, sets `status: 'VERIFIED_PRIMARY'` and records `retrievedOn`.
 *
 * OPEN POINT 1 — Section B negative marking.
 *   Sources disagree on whether the numeric-response section carries -1 or 0
 *   for a wrong answer. This file encodes -1. If the bulletin says otherwise,
 *   change `incorrect` on the Section B marking rules only.
 *
 * OPEN POINT 2 — internal choice in Section B.
 *   Historically candidates answered 5 of 10 numeric questions; the optional
 *   choice was subsequently removed. This file encodes 5 compulsory questions
 *   (questionCount 5, requiredCount 5). If choice has been reinstated, set
 *   questionCount to the offered count and requiredCount to the answered count
 *   — the shape already supports it, no code change is needed.
 *
 * Everything else (75 questions, 300 marks, 180 minutes, +4, three subjects at
 * 100 marks each) is stable across many years and is low-risk.
 */

const SUBJECTS: readonly Subject[] = ['PHYSICS', 'CHEMISTRY', 'MATHEMATICS'];

function sectionsForSubject(subject: Subject, baseOrdinal: number): PatternSection[] {
  return [
    {
      ordinal: baseOrdinal,
      name: `${titleCase(subject)} — Section A`,
      subject,
      questionType: 'MCQ_SINGLE',
      questionCount: 20,
      requiredCount: 20,
      maxMarks: 80,
      durationSeconds: null,
      marking: {
        questionType: 'MCQ_SINGLE',
        correct: 4,
        incorrect: -1,
        unattempted: 0,
      },
    },
    {
      ordinal: baseOrdinal + 1,
      name: `${titleCase(subject)} — Section B`,
      subject,
      questionType: 'NUMERIC_INTEGER',
      questionCount: 5,
      requiredCount: 5,
      maxMarks: 20,
      durationSeconds: null,
      marking: {
        questionType: 'NUMERIC_INTEGER',
        correct: 4,
        incorrect: -1, // OPEN POINT 1
        unattempted: 0,
        numeric: { kind: 'EXACT_INTEGER' },
        penaliseUnparseable: true,
      },
    },
  ];
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

export const JEE_MAIN_2026_P1: ExamPattern = {
  id: 'JEE_MAIN-2026-P1',
  exam: 'JEE_MAIN',
  year: 2026,
  paper: 'Paper 1 (B.E./B.Tech)',
  durationMinutes: 180,
  totalMarks: 300,
  sections: SUBJECTS.flatMap((subject, i) => sectionsForSubject(subject, i * 2 + 1)),
  // Published chain leads with Mathematics, then Physics, then Chemistry.
  tieBreak: [
    { kind: 'TOTAL_SCORE_DESC' },
    { kind: 'SUBJECT_SCORE_DESC', subject: 'MATHEMATICS' },
    { kind: 'SUBJECT_SCORE_DESC', subject: 'PHYSICS' },
    { kind: 'SUBJECT_SCORE_DESC', subject: 'CHEMISTRY' },
    { kind: 'FEWER_INCORRECT' },
    { kind: 'EARLIER_SUBMISSION' },
    { kind: 'STABLE_ID' },
  ],
  provenance: {
    sourceUrl: 'https://jeemain.nta.nic.in/',
    sourceLabel: 'NTA JEE (Main) 2026 Information Bulletin',
    retrievedOn: null,
    status: 'UNVERIFIED',
    notes:
      'Section B negative marking (-1 vs 0) and internal choice are unconfirmed. See OPEN POINT 1 and 2 in this file.',
  },
};
