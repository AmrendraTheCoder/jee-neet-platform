/**
 * The script that runs inside the math WebView.
 *
 * Written as ES5 in a string rather than as a bundled module: it executes in a
 * document that has no module loader, and keeping it dependency-free means the
 * only things in that WebView are KaTeX and these ~140 lines. The message
 * contract it implements is specified in `protocol.ts` — that file is the
 * schema, this is one of its two implementations.
 */

export const HOST_SCRIPT = `
(function () {
  'use strict';

  var root = document.getElementById('root');
  var lastReportedHeight = -1;
  var currentDocId = null;

  function post(message) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  function reportSize() {
    if (currentDocId === null) return;
    var height = Math.ceil(document.documentElement.scrollHeight);
    if (height === lastReportedHeight) return;
    lastReportedHeight = height;
    post({ type: 'size', docId: currentDocId, height: height });
  }

  function renderMath(target, latex, displayMode) {
    if (typeof window.katex === 'undefined') {
      target.className = 'render-error';
      target.textContent = latex;
      post({ type: 'renderError', docId: currentDocId, detail: 'katex-unavailable' });
      return;
    }
    try {
      window.katex.render(latex, target, {
        displayMode: displayMode === true,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        macros: {}
      });
    } catch (error) {
      target.className = 'render-error';
      target.textContent = latex;
      post({
        type: 'renderError',
        docId: currentDocId,
        detail: error && error.message ? String(error.message) : 'unknown'
      });
    }
  }

  function buildBlock(block) {
    var element = document.createElement('div');
    element.className = 'block';

    if (block.kind === 'text') {
      element.className = 'block prose';
      element.textContent = block.value;
      return element;
    }
    if (block.kind === 'math') {
      renderMath(element, block.value, block.display);
      return element;
    }
    if (block.kind === 'html') {
      element.innerHTML = block.value;
      return element;
    }

    element.className = 'render-error';
    element.textContent = 'unsupported block kind: ' + String(block.kind);
    return element;
  }

  function buildOption(option, index, multi) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.setAttribute('role', multi ? 'checkbox' : 'radio');
    button.setAttribute('aria-checked', option.selected ? 'true' : 'false');
    button.setAttribute('data-option-id', option.optionId);
    button.setAttribute(
      'aria-label',
      'Option ' + String(index + 1) + '. ' + (option.spokenText || option.plainText || '')
    );

    var marker = document.createElement('span');
    marker.className = 'option-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = String.fromCharCode(65 + index);
    button.appendChild(marker);

    var body = document.createElement('span');
    body.className = 'option-body';
    for (var i = 0; i < option.blocks.length; i += 1) {
      body.appendChild(buildBlock(option.blocks[i]));
    }
    button.appendChild(body);

    button.addEventListener('click', function () {
      post({ type: 'select', docId: currentDocId, optionId: option.optionId });
    });

    return button;
  }

  function applyTheme(theme) {
    var style = document.documentElement.style;
    for (var key in theme) {
      if (Object.prototype.hasOwnProperty.call(theme, key)) {
        style.setProperty('--' + key, String(theme[key]));
      }
    }
  }

  function render(payload) {
    currentDocId = payload.docId;
    lastReportedHeight = -1;
    if (payload.theme) applyTheme(payload.theme);

    root.textContent = '';

    var container = document.createElement('div');
    for (var i = 0; i < payload.blocks.length; i += 1) {
      container.appendChild(buildBlock(payload.blocks[i]));
    }
    root.appendChild(container);

    if (payload.options && payload.options.length > 0) {
      var group = document.createElement('div');
      group.className = 'options';
      group.setAttribute('role', payload.multiSelect ? 'group' : 'radiogroup');
      group.setAttribute('aria-label', 'Answer options');
      for (var j = 0; j < payload.options.length; j += 1) {
        group.appendChild(buildOption(payload.options[j], j, payload.multiSelect === true));
      }
      root.appendChild(group);
    }

    reportSize();
  }

  window.__mathHost = {
    receive: function (json) {
      try {
        var payload = typeof json === 'string' ? JSON.parse(json) : json;
        if (payload.type === 'render') {
          render(payload);
        } else if (payload.type === 'theme') {
          applyTheme(payload.theme);
          reportSize();
        } else if (payload.type === 'setSelection') {
          var nodes = root.querySelectorAll('.option');
          for (var i = 0; i < nodes.length; i += 1) {
            var id = nodes[i].getAttribute('data-option-id');
            nodes[i].setAttribute(
              'aria-checked',
              payload.selectedOptionIds.indexOf(id) >= 0 ? 'true' : 'false'
            );
          }
        }
      } catch (error) {
        post({
          type: 'renderError',
          docId: currentDocId,
          detail: error && error.message ? String(error.message) : 'bad-payload'
        });
      }
    }
  };

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(reportSize).observe(document.documentElement);
  }
  window.addEventListener('load', reportSize);

  post({ type: 'ready', katex: typeof window.katex !== 'undefined' });
})();
`;
