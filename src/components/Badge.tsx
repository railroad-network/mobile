/**
 * Badge — a compact status label (transaction state, tier, count). A tinted
 * pill with an optional leading status dot. Mirrors the design system's Badge.
 */
import {StyleSheet, View} from 'react-native';

import {useTheme, type ColorTokens} from '../theme';
import {Text} from './Text';

export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent';

export interface BadgeProps {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  /** Show a leading status dot in the badge's own color. */
  dot?: boolean;
  children: string;
}

/** Resolves a variant to its {background, foreground} pair. */
function palette(variant: BadgeVariant, c: ColorTokens): {bg: string; fg: string} {
  switch (variant) {
    case 'success':
      return {bg: c.successTint, fg: c.success};
    case 'warning':
      return {bg: c.warningTint, fg: c.warning};
    case 'danger':
      return {bg: c.dangerTint, fg: c.danger};
    case 'info':
      return {bg: c.infoTint, fg: c.info};
    case 'accent':
      return {bg: c.accentTint, fg: c.accentStrong};
    case 'neutral':
    default:
      return {bg: c.surfaceSunken, fg: c.textSecondary};
  }
}

export function Badge({variant = 'neutral', size = 'md', dot = false, children}: BadgeProps) {
  const theme = useTheme();
  const {bg, fg} = palette(variant, theme.colors);
  const sm = size === 'sm';

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: bg,
          borderRadius: theme.radius.full,
          paddingVertical: sm ? 3 : 4,
          paddingHorizontal: sm ? 8 : 10,
        },
      ]}
      accessibilityRole="text">
      {dot && <View style={[styles.dot, {backgroundColor: fg}]} />}
      <Text variant={sm ? 'caption' : 'label'} color={fg} style={styles.text}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start'},
  dot: {width: 7, height: 7, borderRadius: 3.5},
  text: {fontWeight: '700'},
});
