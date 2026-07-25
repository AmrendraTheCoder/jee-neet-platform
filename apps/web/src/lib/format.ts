/**
 * Presentation-only formatting. Nothing here participates in scoring or in the
 * deadline; those live in @platform/domain and on the server respectively.
 */

/** `HH:MM:SS`, always three groups, for the examination clock. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Spoken form for the timer's live region — "1 hour 12 minutes remaining". */
export function describeRemaining(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'less than one minute remaining';
  return `${parts.join(' ')} remaining`;
}

const IST_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * FR-TST-03 forbids per-timezone windows: a test has one absolute start and
 * one absolute end. FR-TST-04 then requires both the canonical IST rendering
 * and the viewer's local rendering, side by side, so a candidate outside IST
 * cannot misread the window.
 */
export function formatIst(epochMs: number): string {
  return `${IST_FORMATTER.format(new Date(epochMs))} IST`;
}

export function formatLocal(epochMs: number): string {
  const local = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(epochMs));
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${local} ${zone}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Signed marks, so a zero reads as "0" and a penalty reads as "-1". */
export function formatMarks(marks: number): string {
  if (marks > 0) return `+${marks}`;
  return String(marks);
}

const TITLE_CASE_EXCEPTIONS = new Set(['and', 'of', 'the', 'in', 'for']);

/** `MCQ_SINGLE` -> `MCQ single`; `MATHEMATICS` -> `Mathematics`. */
export function humanizeEnum(value: string): string {
  const words = value.toLowerCase().split('_');
  return words
    .map((word, index) => {
      if (index > 0 && TITLE_CASE_EXCEPTIONS.has(word)) return word;
      if (word === 'mcq') return 'MCQ';
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
