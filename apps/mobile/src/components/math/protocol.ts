/**
 * The native <-> math-host message contract.
 *
 * Both sides of this protocol are in this repository, but they are separated by
 * a JSON string boundary that TypeScript cannot check, so the types here are the
 * only specification there is. Changing a field name in host.html without
 * changing it here fails silently at runtime — treat this file as the schema.
 */

import type { OptionId } from '@platform/domain';

/**
 * A renderable fragment of question or note content.
 *
 * `html` is the server-pre-rendered KaTeX output and is the path every published
 * item takes (FR-MTH-01). `math` typesets in the client and exists for two cases
 * the server cannot pre-render: text a student wrote in a note, and content
 * cached on the device before the server re-rendered it.
 */
export type ContentBlock =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'math'; readonly value: string; readonly display: boolean }
  | { readonly kind: 'html'; readonly value: string };

export interface RenderableOption {
  readonly optionId: OptionId;
  readonly blocks: readonly ContentBlock[];
  /** Authored accessibility string (FR-ITM-12); falls back to plain text. */
  readonly spokenText: string | null;
  readonly plainText: string;
  readonly selected: boolean;
}

/** CSS custom properties pushed into the host page, mirroring the theme tokens. */
export interface MathHostTheme {
  readonly bg: string;
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly accent: string;
  readonly 'accent-muted': string;
  readonly danger: string;
  readonly 'danger-muted': string;
  readonly 'font-size': string;
}

export type HostInbound =
  | {
      readonly type: 'render';
      readonly docId: string;
      readonly blocks: readonly ContentBlock[];
      readonly options: readonly RenderableOption[];
      readonly multiSelect: boolean;
      readonly theme: MathHostTheme;
    }
  | { readonly type: 'theme'; readonly theme: MathHostTheme }
  | { readonly type: 'setSelection'; readonly selectedOptionIds: readonly string[] };

export type HostOutbound =
  | { readonly type: 'ready'; readonly katex: boolean }
  | { readonly type: 'size'; readonly docId: string; readonly height: number }
  | { readonly type: 'select'; readonly docId: string; readonly optionId: string }
  | { readonly type: 'renderError'; readonly docId: string | null; readonly detail: string };

export function parseOutbound(raw: string): HostOutbound | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const type = (value as { type?: unknown }).type;
    if (
      type === 'ready' ||
      type === 'size' ||
      type === 'select' ||
      type === 'renderError'
    ) {
      return value as HostOutbound;
    }
    return null;
  } catch {
    // A malformed message from the host page must never crash the session; the
    // caller treats null as "nothing happened" and the question stays usable.
    return null;
  }
}

/**
 * Build the injected-JavaScript string for one inbound message.
 *
 * The trailing `true;` is required: a WebView evaluates the injected source and
 * on iOS a non-serialisable trailing expression value produces a warning on
 * every call, which at one call per question navigation is a lot of noise.
 */
export function injection(message: HostInbound): string {
  return `window.__mathHost && window.__mathHost.receive(${JSON.stringify(JSON.stringify(message))}); true;`;
}

/**
 * Split a string on `$...$` and `$$...$$` into blocks.
 *
 * Used only for student-authored note text (FR-NTS-02). Published items arrive
 * as structured blocks from the server and never go through this — inferring
 * mathematics from delimiters in a published item would make a stray currency
 * symbol change how a question renders.
 */
export function blocksFromDelimitedText(source: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let cursor = 0;

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    if (match.index > cursor) {
      blocks.push({ kind: 'text', value: source.slice(cursor, match.index) });
    }
    const display = match[1];
    const inline = match[2];
    if (display !== undefined) {
      blocks.push({ kind: 'math', value: display, display: true });
    } else if (inline !== undefined) {
      blocks.push({ kind: 'math', value: inline, display: false });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) {
    blocks.push({ kind: 'text', value: source.slice(cursor) });
  }

  return blocks;
}

/** Whether a set of blocks needs the WebView at all. */
export function needsMathHost(blocks: readonly ContentBlock[]): boolean {
  return blocks.some((block) => block.kind !== 'text');
}
