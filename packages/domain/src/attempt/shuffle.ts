/**
 * Deterministic per-attempt shuffling (FR-ATT-10, FR-ATT-11, EC-RAND-01).
 *
 * Requirements this satisfies:
 *   - identical order on every resume, every device, and after a reinstall
 *   - reproducible months later for dispute resolution
 *   - unpredictable to the client, which never receives the seed
 *
 * The seed is derived server-side from an HMAC over the attempt id and a server
 * secret. That derivation is NOT in this module, deliberately: keeping the
 * secret out of the domain package means this code can be imported anywhere
 * without dragging a credential into the bundle. Callers pass the derived seed.
 */

/** FNV-1a 32-bit, used to fold an arbitrary seed string into PRNG state. */
function seedToUint32(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * mulberry32 — small, fast, and fully deterministic across engines.
 *
 * Not cryptographically secure, and it does not need to be: the security
 * property comes from the seed being an HMAC the client never sees, not from
 * the generator. What this must guarantee is bit-identical output on every
 * platform, forever, which a named published algorithm does and `Math.random`
 * emphatically does not.
 */
export function mulberry32(seedValue: number): () => number {
  let a = seedValue >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates over a copy. Never mutates the input.
 *
 * The same (items, seed) pair always produces the same output. That is the
 * whole point: `attempts.question_order` is materialised once at attempt start
 * and read thereafter, but being able to *re-derive* it from the stored seed is
 * what makes an attempt auditable years later.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const random = mulberry32(seedToUint32(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export interface OptionShuffleInput {
  readonly questionVersionId: string;
  readonly optionIds: readonly string[];
  /** Authored per item, default off (FR-ITM-10). */
  readonly shuffleOptions: boolean;
  /**
   * Options that must retain a fixed position, e.g. "None of the above".
   * Keyed by option id, value is the 0-based position to pin to.
   */
  readonly pinnedPositions?: Readonly<Record<string, number>>;
}

/**
 * Shuffle options within a question, honouring pinned positions.
 *
 * Scoring can never be broken by a shuffle, because the key is stored as option
 * identity rather than as a letter. The risk is purely *semantic* — "All of the
 * above" moving to position B refers to nothing coherent — which is why the
 * authoring linter, not this function, is the real control (FR-ITM-11). This
 * function simply refuses to move anything it was told not to move.
 */
export function shuffleOptions(input: OptionShuffleInput, attemptSeed: string): string[] {
  if (!input.shuffleOptions) return [...input.optionIds];

  const pinned = input.pinnedPositions ?? {};
  const pinnedIds = new Set(Object.keys(pinned));
  const movable = input.optionIds.filter((id) => !pinnedIds.has(id));

  // Derive a per-question seed so two questions in one attempt do not receive
  // correlated permutations.
  const shuffled = seededShuffle(movable, `${attemptSeed}:${input.questionVersionId}`);

  const out: (string | undefined)[] = new Array<string | undefined>(input.optionIds.length);
  for (const [id, position] of Object.entries(pinned)) {
    if (position < 0 || position >= out.length) {
      throw new RangeError(
        `pinned position ${position} for option ${id} is outside the option list`,
      );
    }
    if (out[position] !== undefined) {
      throw new Error(`two options pinned to position ${position}`);
    }
    out[position] = id;
  }

  let cursor = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === undefined) {
      out[i] = shuffled[cursor];
      cursor += 1;
    }
  }

  return out as string[];
}

/**
 * Assert that a client-supplied question id belongs to this attempt.
 *
 * EC-DATA-09 in one line. Callers run this on every inbound response before it
 * is written; without it, a positional-mapping bug records every answer against
 * the wrong question, silently, and presents as poor performance.
 */
export function assertInQuestionOrder(
  questionVersionId: string,
  questionOrder: readonly string[],
): void {
  if (!questionOrder.includes(questionVersionId)) {
    throw new Error(
      `question ${questionVersionId} is not part of this attempt's materialised order`,
    );
  }
}
