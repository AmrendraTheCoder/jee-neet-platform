/**
 * In-app rough work (FR-SRS-06).
 *
 * This is not a nice-to-have drawing toy. It is the mitigation for a structural
 * problem: these subjects are worked on paper, and a student who puts the phone
 * down for four minutes to do algebra produces two false signals at once — a
 * "fast, confident" response time, and on one platform an app-backgrounded
 * event that an integrity layer reads as a cheating indicator. The most
 * diligent students look the most suspicious.
 *
 * Keeping the rough work inside the app fixes both: the app stays foregrounded,
 * and the stroke timeline is an honest measure of engaged time in a way that
 * "the question was on screen" never was.
 *
 * The strokes stay on the device. They are the student's working, not telemetry,
 * and there is no pedagogical purpose that justifies uploading them.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import type { QuestionVersionId } from '@platform/domain';
import { useColors } from '../../../theme/ThemeProvider.js';
import { radius, space } from '../../../theme/tokens.js';
import { Button } from '../../../components/ui/Button.js';
import { Text } from '../../../components/ui/Text.js';
import { loadStrokes, saveStrokes } from '../scratchpadStore.js';

/**
 * Minimum distance between recorded points, in points.
 *
 * A pan gesture reports at display refresh rate, and each report crosses to the
 * JavaScript thread. Dropping sub-pixel movement removes most of that traffic
 * with no visible change to the line, which is the difference between a
 * responsive pad and a laggy one on a mid-range device.
 */
const MIN_POINT_DISTANCE = 2;

export interface ScratchpadProps {
  readonly questionVersionId: QuestionVersionId;
  readonly height?: number;
}

export function Scratchpad(props: ScratchpadProps): ReactNode {
  const colors = useColors();
  const [strokes, setStrokes] = useState<readonly string[]>([]);
  const [current, setCurrent] = useState<string>('');
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadStrokes(props.questionVersionId).then((loaded) => {
      if (!cancelled) setStrokes(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [props.questionVersionId]);

  const begin = useCallback((x: number, y: number) => {
    last.current = { x, y };
    setCurrent(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
  }, []);

  const extend = useCallback((x: number, y: number) => {
    const previous = last.current;
    if (previous !== null) {
      const dx = x - previous.x;
      const dy = y - previous.y;
      if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) return;
    }
    last.current = { x, y };
    setCurrent((path) => `${path} L ${x.toFixed(1)} ${y.toFixed(1)}`);
  }, []);

  const finish = useCallback(() => {
    last.current = null;
    setCurrent((path) => {
      if (path === '') return '';
      setStrokes((previous) => {
        const next = [...previous, path];
        void saveStrokes(props.questionVersionId, next);
        return next;
      });
      return '';
    });
  }, [props.questionVersionId]);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      runOnJS(begin)(event.x, event.y);
    })
    .onUpdate((event) => {
      runOnJS(extend)(event.x, event.y);
    })
    .onFinalize(() => {
      runOnJS(finish)();
    });

  const undo = (): void => {
    setStrokes((previous) => {
      const next = previous.slice(0, -1);
      void saveStrokes(props.questionVersionId, next);
      return next;
    });
  };

  const clear = (): void => {
    setStrokes([]);
    void saveStrokes(props.questionVersionId, []);
  };

  const height = props.height ?? 280;

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="heading" accessibilityRole="header">
        Rough work
      </Text>
      <Text variant="caption" tone="muted">
        Work here instead of on paper and the app stays open, so your time on this question is
        recorded honestly and nothing is misread as you leaving the app.
      </Text>

      <GestureDetector gesture={pan}>
        <View
          // Not announced as an interactive control: a screen-reader user is not
          // drawing here, and exposing it would put an unusable element in the
          // focus order between the question and its options.
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={{
            height,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            overflow: 'hidden',
          }}
        >
          <Svg width="100%" height="100%">
            {strokes.map((path, index) => (
              <Path
                key={`${String(index)}:${path.length.toString()}`}
                d={path}
                stroke={colors.text}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            {current === '' ? null : (
              <Path
                d={current}
                stroke={colors.text}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            )}
          </Svg>
        </View>
      </GestureDetector>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button
          variant="secondary"
          label="Undo"
          onPress={undo}
          disabled={strokes.length === 0}
          style={{ flex: 1 }}
        />
        <Button
          variant="secondary"
          label="Clear"
          onPress={clear}
          disabled={strokes.length === 0 && current === ''}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}
