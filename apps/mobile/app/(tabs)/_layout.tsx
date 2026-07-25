import { Tabs } from 'expo-router';

import { useColors } from '~/theme/ThemeProvider.js';

/**
 * Two tabs, and there is a reason it is not more.
 *
 * This client owns practice, review and notes. It never renders a ranked mock —
 * a three-hour pixel-faithful clone of a desktop CBT on a six-inch phone is not
 * a fidelity clone, it is a different exam. So there is no "Tests" tab here and
 * adding one is a product decision, not a navigation tweak.
 */
export default function TabsLayout(): React.ReactNode {
  const colors = useColors();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surfaceRaised,
          borderTopColor: colors.border,
        },
        // Labels always visible. An icon-only tab bar is unusable for a student
        // meeting the app for the first time, and the icons here would be
        // guessable at best.
        tabBarShowLabel: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Practice' }} />
      <Tabs.Screen name="review" options={{ title: 'Review' }} />
    </Tabs>
  );
}
