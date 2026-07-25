/**
 * Stylesheet for the math host document.
 *
 * Every colour is a CSS custom property so a theme change is a property update
 * pushed over the message channel rather than a document reload. Reloading costs
 * the whole KaTeX parse again and is visible as a flash on a mid-range device.
 */

export const HOST_STYLES = `
:root {
  --bg: #ffffff;
  --surface: #ffffff;
  --text: #14181f;
  --muted: #59616e;
  --border: #d9dde4;
  --accent: #1f4fd8;
  --accent-muted: #e6ecfd;
  --danger: #a51c2c;
  --danger-muted: #fbe6e8;
  --font-size: 16px;
}

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-size: var(--font-size);
  line-height: 1.5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  /* The native side owns scrolling. A scroller here gives the student two
     nested scroll containers and steals the parent's fling. */
  overflow: hidden;
}

.block { margin: 0 0 12px 0; }
.block:last-child { margin-bottom: 0; }
.prose { white-space: pre-wrap; word-break: break-word; }

/* A long derivation scrolls inside itself. Letting it widen the document makes
   the whole question pannable sideways, which loses the option list off-screen
   on a 6-inch phone. */
.katex-display {
  margin: 12px 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
}

/* FR-MTH-03: a fragment that fails to typeset degrades to its source with a
   visible marker, and the surrounding question keeps working. One malformed
   item must never end a session. */
.render-error {
  display: block;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: var(--danger-muted);
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 6px;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.options { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }

/* FR-A11Y-02: the 44pt floor applies inside the WebView too; the native
   minimum is not applied for us here. */
.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 44px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.option[aria-checked='true'] { border-color: var(--accent); background: var(--accent-muted); }
.option:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.option-marker {
  flex: 0 0 auto;
  min-width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85em;
  color: var(--muted);
}

.option[aria-checked='true'] .option-marker { border-color: var(--accent); color: var(--accent); }
.option-body { flex: 1 1 auto; min-width: 0; }
`;
