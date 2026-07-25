import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * The mathematics engine, bundled locally (FR-MTH-05).
 *
 * Bundled, not fetched from a CDN, for three reasons that all bite in this
 * market: coaching-centre and school networks block third-party origins; a CDN
 * fetch during an examination is a dependency on someone else's uptime inside
 * a window nobody can extend; and a version drift between the admin preview
 * and the student client would let an author approve an item that renders
 * differently for the candidate (FR-AUT-01).
 *
 * ONE renderer per screen, never one per list row. There is exactly one module
 * instance of KaTeX in the bundle and one `MathScope` per screen holds the
 * render function; components call through it. The React Native client has the
 * same rule for a harder reason (a WebView per row costs 150-200 MB against a
 * 4 GB baseline device), and keeping the web rule identical means the two
 * clients cannot diverge on which renderer version is authoritative.
 */

export const RENDERER_ID = 'katex';

/** Reported to the server on a render failure so an incident names a version. */
export const RENDERER_VERSION: string = katex.version;

export interface RenderOptions {
  readonly displayMode: boolean;
}

export class MathRenderError extends Error {
  constructor(
    readonly source: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : 'LaTeX could not be rendered');
    this.name = 'MathRenderError';
  }
}

/**
 * Render one expression.
 *
 * `macros` is a FRESH object on every call (FR-MTH-04). KaTeX mutates the
 * macros object it is handed, so a shared one would let `\newcommand` in one
 * question leak into the next — which is both a rendering bug and, in an
 * authoring pipeline, a way for one item to change how another item reads.
 *
 * `strict: false` and `throwOnError: false` are deliberate at *render* time
 * (FR-MTH-03): one malformed item must never take down a live paper. Strict
 * validation is a server-side publish gate instead (FR-MTH-02), where a
 * failure costs an author a fix rather than a candidate their marks.
 */
export function renderLatexToHtml(source: string, options: RenderOptions): string {
  try {
    return katex.renderToString(source, {
      displayMode: options.displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'htmlAndMathml',
      macros: {},
    });
  } catch (cause) {
    throw new MathRenderError(source, cause);
  }
}

/**
 * Strict render, used only by the authoring preview and the publish gate.
 *
 * Throws on anything KaTeX considers an error so the author sees the failure
 * the server-side validator will also see. The two must agree; a preview that
 * is more forgiving than the gate teaches authors to ignore it.
 */
export function renderLatexStrict(source: string, options: RenderOptions): string {
  try {
    return katex.renderToString(source, {
      displayMode: options.displayMode,
      throwOnError: true,
      strict: 'error',
      trust: false,
      output: 'htmlAndMathml',
      macros: {},
    });
  } catch (cause) {
    throw new MathRenderError(source, cause);
  }
}

/**
 * Render a mixed prose-and-mathematics string.
 *
 * Prose stays as text nodes and only the delimited spans go through the
 * engine. Wrapping a whole paragraph in maths mode is the usual shortcut and
 * it produces unreadable spacing, breaks text selection, and makes the
 * paragraph invisible to a screen reader as prose.
 */
export function renderMixedLatex(source: string): string {
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let out = '';
  let cursor = 0;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += escapeHtml(source.slice(cursor, index));
    const display = match[1];
    const inline = match[2];
    if (display !== undefined) out += renderLatexToHtml(display, { displayMode: true });
    else if (inline !== undefined) out += renderLatexToHtml(inline, { displayMode: false });
    cursor = index + match[0].length;
  }

  out += escapeHtml(source.slice(cursor));
  return out;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
