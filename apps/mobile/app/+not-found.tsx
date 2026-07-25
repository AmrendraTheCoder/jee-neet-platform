import { router } from 'expo-router';
import { View } from 'react-native';

import { Screen } from '~/components/ui/Screen.js';
import { Banner } from '~/components/ui/Banner.js';
import { Button } from '~/components/ui/Button.js';
import { space } from '~/theme/tokens.js';

/**
 * Reached by a deep link that no longer resolves — a notification for a card
 * that has since been suspended, or a shared link from a newer build.
 */
export default function NotFoundScreen(): React.ReactNode {
  return (
    <Screen title="Not found">
      <View style={{ padding: space.lg, gap: space.md }}>
        <Banner
          tone="info"
          title="That link does not go anywhere"
          body="It may point at something that has moved or been removed."
        />
        <Button label="Go to practice" onPress={() => router.replace('/')} fullWidth />
      </View>
    </Screen>
  );
}
