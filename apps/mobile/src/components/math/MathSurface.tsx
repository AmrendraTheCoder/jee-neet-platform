/**
 * The screen's single math WebView (FR-MTH-05).
 *
 * Mounted once per screen, kept alive across question navigation, and fed new
 * content over the message channel. Unmounting and remounting per question would
 * pay the WebView instantiation cost — the expensive part — on every Save & Next.
 *
 * When a question contains mathematics its options are rendered inside this same
 * document rather than as native rows. That is a deliberate trade: an option
 * whose text is an integral cannot be typeset natively, and a WebView per option
 * is precisely the pattern this component exists to prevent. The host document
 * carries the accessibility semantics (radio/checkbox roles, aria-checked,
 * per-option labels from the authored spoken text) and the 44pt floor, so the
 * option list is still operable by a screen reader and by a large-text user.
 *
 * Questions with no mathematics never reach this component at all — see
 * `QuestionBody`, which routes them to fully native rendering.
 */

import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import { WebView } from 'react-native-webview';

import { mathHostDocument } from './hostHtml.js';
import { useMathHost } from './MathHostProvider.js';
import type { ContentBlock, RenderableOption } from './protocol.js';
import { injection, parseOutbound } from './protocol.js';

export interface MathSurfaceProps {
  /** Stable identity for the owning screen; also the duplicate-mount key. */
  readonly owner: string;
  /** Changing this replaces the document. Use the question version id. */
  readonly docId: string;
  readonly blocks: readonly ContentBlock[];
  readonly options?: readonly RenderableOption[];
  readonly multiSelect?: boolean;
  readonly onSelectOption?: (optionId: string) => void;
  /**
   * Called when a fragment fails to typeset (FR-MTH-03). The caller raises an
   * incident and offers "Report this question"; it must not tear the screen down.
   */
  readonly onRenderError?: (detail: string) => void;
  readonly minHeight?: number;
}

function MathSurfaceImpl(props: MathSurfaceProps): ReactNode {
  const host = useMathHost();
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(props.minHeight ?? 120);
  const document = useMemo(() => mathHostDocument(), []);

  const { owner, claim, release } = { owner: props.owner, claim: host.claim, release: host.release };
  useEffect(() => {
    claim(owner);
    return () => {
      release(owner);
    };
  }, [owner, claim, release]);

  // The payload is memoised on content identity, not rebuilt per render. Without
  // this, an unrelated state change on the screen — a timer tick, a pending-sync
  // count — reserialises the whole question and re-injects it, which re-typesets
  // the mathematics and visibly flickers.
  const payload = useMemo(
    () =>
      injection({
        type: 'render',
        docId: props.docId,
        blocks: props.blocks,
        options: props.options ?? [],
        multiSelect: props.multiSelect ?? false,
        theme: host.theme,
      }),
    [props.docId, props.blocks, props.options, props.multiSelect, host.theme],
  );

  useEffect(() => {
    if (!ready) return;
    webRef.current?.injectJavaScript(payload);
  }, [ready, payload]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseOutbound(event.nativeEvent.data);
      if (message === null) return;

      switch (message.type) {
        case 'ready':
          setReady(true);
          if (!message.katex) {
            props.onRenderError?.('katex-unavailable');
          }
          break;
        case 'size':
          // Only grow-or-shrink on a real change; the host already de-duplicates,
          // but a stale message for a previous document would resize the wrong
          // question.
          if (message.docId === props.docId) {
            setHeight(Math.max(props.minHeight ?? 0, message.height));
          }
          break;
        case 'select':
          if (message.docId === props.docId) {
            props.onSelectOption?.(message.optionId);
          }
          break;
        case 'renderError':
          props.onRenderError?.(message.detail);
          break;
      }
    },
    [props],
  );

  return (
    <View style={{ height }} collapsable={false}>
      <WebView
        ref={webRef}
        source={{ html: document }}
        onMessage={onMessage}
        originWhitelist={['about:*']}
        javaScriptEnabled
        domStorageEnabled={false}
        // Nothing in this document may navigate. A question body is content, not
        // a browser, and a solution video link that opened here would both leak
        // and escape the router's in-session navigation block (EC-NOTES-04).
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        scrollEnabled={false}
        nestedScrollEnabled={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        // The host page owns its own text sizing from the theme's font-size
        // property, which already includes the OS scale factor. Letting the
        // WebView apply the system scale as well would compound it.
        textZoom={100}
        style={{ backgroundColor: 'transparent', flex: 1 }}
        containerStyle={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}

export const MathSurface = memo(MathSurfaceImpl);
