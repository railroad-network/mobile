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
    shadowColor: '#211B14',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
    elevation: 2,
  },
});
