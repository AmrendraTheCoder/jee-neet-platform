import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { RENDERER_ID, RENDERER_VERSION, renderMixedLatex } from './engine.js';
import { sanitizeHtml } from './sanitize.js';
import './math.css';

/**
 * ONE renderer per screen (FR-MTH-05).
 *
 * The scope is the enforcement point. Components never import the engine
 * directly; they take the renderer from this context, which exists once per
 * screen. That makes "a renderer per list row" a structural impossibility
 * rather than a review comment — a row cannot create a scope, only consume one.
 *
 * It also memoises. A 180-question paper view re-renders on every palette
 * change; without the cache each of those re-renders re-sanitises 180 bodies.
 * The cache is keyed on the exact source string, so a correction that changes
 * the source misses the cache and re-renders, which is the correct behaviour.
 */

export interface MathScopeValue {
  readonly rendererId: string;
  readonly rendererVersion: string;
  /** Sanitise pre-rendered server HTML (FR-MTH-01). */
  prepare(bodyHtml: string): string;
  /** Render LaTeX at runtime. Authoring preview only, never the student path. */
  renderSource(latex: string): string;
}

const MathScopeContext = createContext<MathScopeValue | null>(null);

export function MathScope(props: { readonly children: ReactNode }): JSX.Element {
  const value = useMemo<MathScopeValue>(() => {
    const prepared = new Map<string, string>();
    const rendered = new Map<string, string>();

    return {
      rendererId: RENDERER_ID,
      rendererVersion: RENDERER_VERSION,
      prepare(bodyHtml) {
        const hit = prepared.get(bodyHtml);
        if (hit !== undefined) return hit;
        const safe = sanitizeHtml(bodyHtml);
        prepared.set(bodyHtml, safe);
        return safe;
      },
      renderSource(latex) {
        const hit = rendered.get(latex);
        if (hit !== undefined) return hit;
        // Sanitised as well as rendered: the authoring preview shows exactly
        // what the student client will show, including what it strips.
        const html = sanitizeHtml(renderMixedLatex(latex));
        rendered.set(latex, html);
        return html;
      },
    };
  }, []);

  return <MathScopeContext.Provider value={value}>{props.children}</MathScopeContext.Provider>;
}

export function useMathScope(): MathScopeValue {
  const value = useContext(MathScopeContext);
  if (value === null) {
    throw new Error(
      'Mathematical content rendered outside a MathScope. Wrap the screen in <MathScope>, ' +
        'never the individual row — one renderer per screen (FR-MTH-05).',
    );
  }
  return value;
}
