/* eslint-disable */
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with `pnpm --filter @platform/mobile vendor:katex`, which reads the
 * pinned `katex` devDependency and inlines its distribution here.
 *
 * The values below are the checked-in bootstrap: empty. With them the math host
 * still loads and every mathematical fragment degrades to its LaTeX source in
 * monospace with a visible marker, which is exactly the FR-MTH-03 fallback path.
 * That is deliberate — a missing vendoring step must look broken in QA rather
 * than silently rendering blank boxes, and the app must still build and run for
 * a developer who has not run the step yet.
 *
 * The bundle is inlined rather than shipped as sibling asset files because a
 * WebView loaded from a generated HTML string has no stable base URL to resolve
 * `./fonts/KaTeX_Main-Regular.woff2` against on both platforms. Inlining costs
 * roughly 640 KB of bundle and buys a renderer that works with no filesystem
 * assumptions, no network, and no per-platform asset plumbing.
 */

/** Contents of katex.min.css, with every font URL rewritten to a data URI. */
export const KATEX_CSS = '';

/** Contents of katex.min.js. */
export const KATEX_JS = '';

/** Contents of contrib/mhchem.min.js. Must be evaluated after KATEX_JS. */
export const MHCHEM_JS = '';

/** Version of the katex package the constants above were taken from. */
export const KATEX_VERSION = 'not-vendored';
