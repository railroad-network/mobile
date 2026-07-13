/**
 * Banner — an inline message in plain, calm language. `warning` for offline /
 * dispute-window states, `danger` for failures, `success` for settlement,
 * `info` for notices. A tinted, bordered block with a colored title, optional
 * body text, and an optional trailing action (e.g. a "Review" button).
 *
 * This is the shared primitive the design system calls `Banner`; the recovery
 * flow's `InlineNotice` re-exports it. There is no leading icon glyph yet — no
 * icon set is linked — so the tint and title carry the variant.
 */
import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {useTheme, type ColorTokens} from '../theme';
import {Text} from './Text';

export type BannerVariant = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  variant?: BannerVariant;
  title: string;
  children?: ReactNode;
  /** Optional trailing action(s), e.g. a small Button. */
  action?: ReactNode;
}

/** Resolves a variant to its {background, border, accent} colors. */
function tint(
  variant: BannerVariant,
  c: ColorTokens,
): {bg: string; border: string; accent: string} {
  switch (variant) {
    case 'success':
      return {bg: c.successTint, border: c.success, accent: c.success};
    case 'warning':
      return {bg: c.warningTint, border: c.warning, accent: c.warning};
    case 'danger':
      return {bg: c.dangerTint, border: c.danger, accent: c.danger};
    case 'info':
    default:
      return {bg: c.infoTint, border: c.info, accent: c.info};
  }
}

export function Banner({variant = 'info', title, children, action}: BannerProps) {
  const {colors, spacing, radius} = useTheme();
  const {bg, border, accent} = tint(variant, colors);

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: bg,
          borderColor: border,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.xs,
        },
      ]}>
      <Text variant="label" color={accent}>
        {title}
      </Text>
      {children !== undefined &&
        (typeof children === 'string' ? (
          <Text variant="caption" color={colors.textSecondary}>
            {children}
          </Text>
        ) : (
          children
        ))}
      {action !== undefined && <View style={{marginTop: spacing.xs}}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {borderWidth: 1},
});
