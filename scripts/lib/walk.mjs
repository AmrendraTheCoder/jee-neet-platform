/**
 * Repository traversal shared by the scanning gates.
 *
 * Build output is deliberately NOT excluded. `dist/`, `build/`, `.next/` and
 * Expo export directories are exactly where NFR-SEC-04 is violated: a
 * privileged credential that is harmless in a server-side source file becomes
 * a full RLS bypass the moment a bundler inlines it into client JavaScript.
 * A secret scanner that skips build output is a scanner that cannot see the
 * failure it was written to catch.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directories that never contain first-party code we are responsible for. */
export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'coverage',
  '.turbo',
  '.cache',
  '.pnpm-store',
  '.vercel',
  '.gradle',
  'Pods',
  'DerivedData',
]);

/** Extensions whose contents are binary; scanning them yields only noise. */
export const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.icns',
  '.svgz',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.jar',
  '.aar',
  '.apk',
  '.aab',
  '.ipa',
  '.so',
  '.dylib',
  '.dll',
  '.node',
  '.wasm',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.webm',
  '.wav',
  '.keystore',
  '.jks',
  '.p12',
  '.mobileprovision',
]);

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Yield every regular file under `root` as a repo-relative POSIX path.
 * @param {string} root
 * @param {(relPath: string) => boolean} [skipDir] extra directory filter
 */
export function* walkFiles(root, skipDir) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (skipDir && skipDir(rel)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        yield rel;
      }
    }
  }
}

export function isProbablyBinary(relPath) {
  const dot = relPath.lastIndexOf('.');
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(relPath.slice(dot).toLowerCase());
}

/** Read a text file, or return null when it is too large or unreadable. */
export function readTextFile(root, relPath) {
  const full = join(root, relPath);
  try {
    if (statSync(full).size > MAX_BYTES) return null;
    const buf = readFileSync(full);
    // A NUL byte in the first 8 KiB means this is binary regardless of suffix.
    if (buf.subarray(0, 8192).includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Repository root, derived from a gate script living directly in `scripts/`.
 * Goes through `fileURLToPath` rather than `URL.pathname` so a checkout path
 * containing spaces or non-ASCII characters resolves correctly.
 */
export function repoRoot(importMetaUrl) {
  return fileURLToPath(new URL('..', importMetaUrl)).replace(/[\\/]$/, '');
}
