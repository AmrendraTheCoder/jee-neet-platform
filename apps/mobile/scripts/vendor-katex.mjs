// Inline the pinned KaTeX distribution into src/components/math/katexBundle.generated.ts.
//
// Why a build step rather than a runtime fetch or sibling asset files:
//   - a CDN request per screen is a network call on a connection that is often
//     absent, and NFR-SCL-11 caps per-screen requests anyway;
//   - the renderer version must be pinned, because the admin console preview and
//     the student client are not allowed to disagree (FR-AUT-01), and KaTeX
//     0.18.0 renamed internal CSS classes, so a floating version is a silent
//     visual regression;
//   - a WebView loaded from a generated HTML string has no stable base URL, so
//     `./fonts/KaTeX_Main-Regular.woff2` cannot be resolved on both platforms.
//     Fonts are therefore rewritten to data URIs.
//
// Only woff2 is inlined. The full fonts directory carries ttf and woff
// duplicates at roughly 1.1 MB; woff2 alone is ~260 KB and is supported by every
// WebView this app runs in.

import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, '..', 'src', 'components', 'math', 'katexBundle.generated.ts');

const katexDist = path.dirname(require.resolve('katex/dist/katex.min.js'));
const katexPkg = JSON.parse(
  await readFile(path.resolve(katexDist, '..', 'package.json'), 'utf8'),
);

const fontDir = path.join(katexDist, 'fonts');
const fontFiles = (await readdir(fontDir)).filter((name) => name.endsWith('.woff2'));

/** @type {Map<string, string>} */
const fontDataUris = new Map();
for (const name of fontFiles) {
  const bytes = await readFile(path.join(fontDir, name));
  fontDataUris.set(name, `data:font/woff2;base64,${bytes.toString('base64')}`);
}

let css = await readFile(path.join(katexDist, 'katex.min.css'), 'utf8');

// KaTeX declares each face with several src entries (woff2, woff, ttf). Drop the
// non-woff2 entries and point the woff2 entry at the inlined data URI.
css = css.replace(/url\(fonts\/([A-Za-z0-9_\-.]+)\.woff2\)/g, (whole, base) => {
  const uri = fontDataUris.get(`${base}.woff2`);
  return uri === undefined ? whole : `url(${uri})`;
});
css = css.replace(/,\s*url\(fonts\/[A-Za-z0-9_\-.]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '');

const js = await readFile(path.join(katexDist, 'katex.min.js'), 'utf8');
const mhchem = await readFile(path.join(katexDist, 'contrib', 'mhchem.min.js'), 'utf8');

/**
 * Emit as a JSON string literal. The KaTeX bundle contains backticks, `${`,
 * backslashes and every quote character; JSON.stringify is the only escaping
 * that is correct for all of them, and it produces a valid TypeScript string.
 */
const literal = (value) => JSON.stringify(value);

const header = `/* eslint-disable */
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate with \`pnpm --filter @platform/mobile vendor:katex\`.
 * Source: katex@${katexPkg.version}, ${fontFiles.length} woff2 faces inlined as data URIs.
 */
`;

const body = [
  header,
  `/** Contents of katex.min.css, with every font URL rewritten to a data URI. */`,
  `export const KATEX_CSS = ${literal(css)};`,
  ``,
  `/** Contents of katex.min.js. */`,
  `export const KATEX_JS = ${literal(js)};`,
  ``,
  `/** Contents of contrib/mhchem.min.js. Must be evaluated after KATEX_JS. */`,
  `export const MHCHEM_JS = ${literal(mhchem)};`,
  ``,
  `/** Version of the katex package the constants above were taken from. */`,
  `export const KATEX_VERSION = ${literal(katexPkg.version)};`,
  ``,
].join('\n');

await writeFile(outFile, body, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
process.stdout.write(
  `vendored katex@${katexPkg.version}: css ${kb(css.length)}, js ${kb(js.length)}, ` +
    `mhchem ${kb(mhchem.length)}, ${fontFiles.length} woff2 faces inlined\n`,
);
