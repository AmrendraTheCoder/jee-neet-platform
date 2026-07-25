import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from '~/theme/ThemeProvider.js';
import { MathHostProvider } from '~/components/math/MathHostProvider.js';
import { startSync } from '~/lib/offline/sync.js';

/**
 * Root layout.
 *
 * Provider order is not arbitrary.
 *
 * `GestureHandlerRootView` must be the outermost native view or gestures below
 * it silently do nothing on Android — silently, which is what makes it worth
 * stating rather than leaving to convention.
 *
 * `MathHostProvider` sits above the navigator, not inside a screen. It owns the
 * single WebView that renders mathematics for the whole app. One per screen
 * would already be wrong; the shape that actually kills the app is one per list
 * row, at 150-200 MB each against a 4 GB baseline device. Hoisting it here
 * makes that mistake impossible to make locally, and it means the renderer and
 * its bundled KaTeX are warm before the first question is drawn instead of
 * costing a visible pause on the first reveal.
 *
 * `startSync` is called once, here, for the same reason: the engine is a module
 * singleton holding one NetInfo listener. Screens subscribe to its state
 * through `useSyncState`; none of them start it.
 */

function Navigator(): React.ReactNode {
  const { scheme } = useTheme();

  return (
    <>
      {/* Follows the resolved scheme rather than the OS one, so an in-app
          theme override does not leave white status text on a white bar. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          // The practice player owns its own header: it carries the clock, and a
          // navigation header above a second header wastes vertical space that
          // a question stem needs on a six-inch screen.
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="practice/[sessionId]" />
        <Stack.Screen name="+not-found" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout(): React.ReactNode {
  useEffect(() => startSync(), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <MathHostProvider>
            <Navigator />
          </MathHostProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
