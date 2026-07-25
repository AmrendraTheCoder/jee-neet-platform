/**
 * Motion vocabulary — five tokens, and nothing else.
 *
 * The values mirror the Material 3 motion specification because it is published,
 * stable and calibrated for exactly the Android hardware this client targets.
 *
 * Deliberate omissions, each of which is a rule rather than an oversight:
 *   - no spring, and no overshoot. A control that bounces past its resting state
 *     reads as playful, and a student watching a countdown does not want playful.
 *     Overshoot also costs frames on a mid-range device for no information gain.
 *   - nothing longer than 400 ms anywhere in a practice session. Motion during a
 *     timed activity is latency the student pays for.
 *   - no shared-element choreography. It is iOS-only in the router today and
 *     silently degrades on Android, which is where nearly all of this audience
 *     is; two platforms would feel like two products.
 */

export const duration = {
  /** In-place state change: option select, chip toggle, checkbox. */
  state: 150,
  /** Small element entering or leaving: banner, toast, inline hint. */
  element: 200,
  /** Screen or list transition. */
  view: 300,
  /** Modal and bottom sheet. */
  surface: 350,
} as const;

export type DurationToken = keyof typeof duration;

/**
 * Cubic-bezier control points.
 *
 * `emphasized` in the specification is a two-segment path that no single cubic
 * bezier reproduces; the decelerate and accelerate halves below are the
 * single-segment approximations the specification itself publishes for use where
 * only one curve is available, which is the case for every animation API here.
 */
export const easing = {
  standard: [0.2, 0, 0, 1],
  decelerate: [0.05, 0.7, 0.1, 1],
  accelerate: [0.3, 0, 0.8, 0.15],
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type EasingToken = keyof typeof easing;

/**
 * Reduced-motion substitute.
 *
 * When reduce-motion is on, every transition collapses to a short opacity fade
 * rather than being removed outright. Removing it entirely makes state changes
 * appear instantaneously with no perceptual anchor, which is its own
 * accessibility problem.
 */
export const REDUCED_MOTION_DURATION = 100;

/**
 * Stagger budget.
 *
 * The animation runtime documents a ceiling of roughly 100 simultaneously
 * animated components on low-end Android. A practice list can easily exceed that
 * if every row animates, so entrance stagger is capped and the rest of the list
 * simply appears.
 */
export const STAGGER_STEP_MS = 25;
export const STAGGER_MAX_CHILDREN = 20;
