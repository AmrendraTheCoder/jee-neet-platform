/**
 * Runtime globals the React Native engine provides and TypeScript cannot infer.
 *
 * `tsconfig.json` here sets `"lib": ["ES2022"]` and `"types": []` on purpose:
 * pulling in the DOM library would make `document`, `window` and `localStorage`
 * typecheck in a client that has none of them, and the resulting error would be
 * a runtime crash on a student's phone rather than a build failure. The cost of
 * that choice is that the handful of platform globals which genuinely do exist
 * have to be declared, which is what this file is for.
 *
 * Keep it minimal. Every addition here is a promise that Hermes provides the
 * symbol on both platforms, and a wrong promise is exactly the crash the narrow
 * lib configuration exists to prevent.
 */

declare global {
  /**
   * Monotonic clock. Unaffected by the user changing the device clock, an NTP
   * resync or a daylight-saving transition — which is why every elapsed-time
   * measurement in this client goes through it and none through `Date.now`.
   */
  const performance: {
    now(): number;
  };

  /**
   * UTF-8 encoder. Reached through `@platform/domain`'s scoring fingerprint,
   * which hashes canonical JSON and must produce byte-identical output on the
   * server, the web client and here.
   */
  class TextEncoder {
    readonly encoding: string;
    encode(input?: string): Uint8Array;
  }
}

export {};
