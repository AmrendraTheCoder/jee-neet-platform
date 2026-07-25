/**
 * Reduce-motion preference (FR-A11Y-03).
 *
 * Read once and subscribed to, because the student can change it from the OS
 * while the app is backgrounded and come back mid-session.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setReduced(value);
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(value);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/** Whether a screen reader is active, used to suppress purely decorative motion. */
export function useScreenReader(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });

    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (value) => {
      setEnabled(value);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return enabled;
}
