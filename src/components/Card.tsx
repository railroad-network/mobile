import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {useTheme} from '../theme';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

/**
 * A raised surface — warm paper card with a hairline border and a short,
 * ink-tinted shadow ("grounded, never glossy"). Matches the design
 * system's `Card` (`--surface-raised`, `--border`, `--shadow-sm`, 8px radius).
 */
export function Card({children, style, padded = true}: CardProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: theme.colors.surfaceRaised,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: padded ? theme.spacing.md : 0,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    // iOS gets the soft, ink-tinted shadow; the shadow* props are iOS-only in
    // RN. Android's shadow is `elevation`, and at this height its spot shadow
    // (dark, on the light surface) reads as a hard gray halo around the card —
    // so Android leans on the hairline border alone, which already grounds it.
    shadowColor: '#211B14',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
  },
});
