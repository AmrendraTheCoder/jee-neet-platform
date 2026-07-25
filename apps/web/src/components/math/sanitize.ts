/**
 * Allowlist sanitiser for server-rendered `body_html`.
 *
 * The HTML injected into the question pane is produced by our own server at
 * write time (FR-MTH-01), so this is defence in depth rather than the primary
 * control. It is here because the primary control is one bug away from being
 * absent: an OCR ingestion path (FR-AUT-06) or a bulk import (FR-AUT-08) puts
 * third-party content into the pipeline, and a stored script in a question
 * body during a live paper is both an integrity failure and a way to read
 * another candidate's session.
 *
 * Allowlist, never a denylist. Denylists lose to the next encoding trick.
 */

const ALLOWED_TAGS = new Set([
  'span', 'div', 'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'sub', 'sup',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre',
  'figure', 'figcaption', 'img', 'hr', 'small',
  // MathML, emitted by the renderer's `htmlAndMathml` output for screen readers.
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext',
  'mspace', 'msub', 'msup', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'mstyle',
  'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mpadded', 'mphantom',
  'menclose', 'mfenced', 'mmultiscripts', 'none', 'mprescripts',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'class', 'style', 'aria-hidden', 'aria-label', 'role', 'colspan', 'rowspan',
  'src', 'alt', 'width', 'height', 'loading', 'decoding',
  // MathML presentation attributes the renderer emits.
  'mathvariant', 'displaystyle', 'scriptlevel', 'encoding', 'display',
  'stretchy', 'fence', 'separator', 'lspace', 'rspace', 'accent', 'accentunder',
  'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'depth', 'voffset',
  'minsize', 'maxsize', 'notation', 'linethickness', 'open', 'close',
]);

/**
 * `style` is allowed because the renderer positions glyphs with inline widths
 * and offsets, and stripping it destroys every fraction and radical on the
 * page. It is filtered to layout properties: a `style` that can load a URL is
 * a network request from question content, which is exactly what must not
 * happen mid-attempt.
 */
const SAFE_STYLE = /^[a-z-]+\s*:\s*[^;:{}()]*$/i;

function sanitizeStyle(value: string): string {
  return value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== '' && SAFE_STYLE.test(declaration))
    .filter((declaration) => !/url\s*\(|expression|@import/i.test(declaration))
    .join('; ');
}

function isSafeImageSrc(value: string): boolean {
  // Same-origin or absolute https only. `javascript:` and `data:` are refused;
  // images are pre-resized and served from our own object store (FR-MTH-07).
  if (value.startsWith('/')) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeElement(element: Element): void {
  const tag = element.tagName.toLowerCase();

  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap rather than delete: an unexpected wrapper must not silently
    // remove the question text inside it. A candidate seeing a blank stem is
    // worse than a candidate seeing unstyled text.
    const parent = element.parentNode;
    if (parent !== null) {
      while (element.firstChild !== null) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
    }
    return;
  }

  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase();
    if (name.startsWith('on') || !ALLOWED_ATTRIBUTES.has(name)) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === 'style') {
      const safe = sanitizeStyle(attribute.value);
      if (safe === '') element.removeAttribute('style');
      else element.setAttribute('style', safe);
      continue;
    }
    if (name === 'src' && !isSafeImageSrc(attribute.value)) {
      element.removeAttribute('src');
    }
  }

  if (tag === 'img') {
    // Question images are already at a fixed set of server-side widths
    // (FR-MTH-07); lazy decoding keeps a 180-question paper-view scroll smooth.
    element.setAttribute('loading', 'lazy');
    element.setAttribute('decoding', 'async');
  }

  for (const child of [...element.children]) sanitizeElement(child);
}

/**
 * Returns sanitised HTML. Never throws: a sanitiser that throws inside a
 * question render turns a content problem into a blank paper.
 */
export function sanitizeHtml(html: string): string {
  try {
    const template = document.createElement('template');
    template.innerHTML = html;
    for (const child of [...template.content.children]) sanitizeElement(child);
    for (const node of template.content.querySelectorAll('script, style, iframe, object, embed, link')) {
      node.remove();
    }
    return template.innerHTML;
  } catch {
    return '';
  }
}
