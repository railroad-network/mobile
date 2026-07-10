import {StyleSheet, View} from 'react-native';

import {Heading, Text} from '../components';
import {useTheme} from '../theme';

/**
 * Stand-in for a screen not built yet. Every M1.2 screen currently routed
 * to renders one of these; T1.2.2+ replace them one at a time without
 * touching the navigation wiring itself.
 */
export function PlaceholderScreen({name}: {name: string}) {
  const theme = useTheme();

  return (
    <View
      style={[styles.container, {gap: theme.spacing.sm, backgroundColor: theme.colors.bg}]}>
      <Heading level="headingSmall">{name}</Heading>
      <Text variant="body" color={theme.colors.textSecondary}>
        Coming in a later task.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
