/**
 * Assemble the single self-contained document loaded into the math WebView.
 *
 * Built once per app run and memoised. The result is handed to the WebView as
 * `source={{ html }}`, so there is no file, no base URL and no asset resolution
 * on either platform — which matters because the two platforms disagree about
 * where a bundled asset lives and what a relative URL inside it resolves to.
 */

import { HOST_SCRIPT } from './hostScript.js';
import { HOST_STYLES } from './hostStyles.js';
import { KATEX_CSS, KATEX_JS, KATEX_VERSION, MHCHEM_JS } from './katexBundle.generated.js';

let cached: string | null = null;

export function mathHostDocument(): string {
  if (cached !== null) return cached;

  // Load order is load-bearing: mhchem extends an already-initialised KaTeX
  // (FR-MTH-06). Reversing these two lines produces chemistry questions that
  // render as literal "\\ce{...}" text.
  const katexScripts =
    KATEX_JS === ''
      ? '<!-- katex not vendored; math degrades to source per FR-MTH-03 -->'
      : `<script>${KATEX_JS}</script><script>${MHCHEM_JS}</script>`;

  cached = [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />',
    `<style>${KATEX_CSS}</style>`,
    `<style>${HOST_STYLES}</style>`,
    katexScripts,
    '</head><body>',
    '<div id="root"></div>',
    `<script>${HOST_SCRIPT}</script>`,
    '</body></html>',
  ].join('');

  return cached;
}

/** Exposed so a diagnostics screen can report which renderer build is live. */
export function mathRendererVersion(): string {
  return KATEX_VERSION;
}
