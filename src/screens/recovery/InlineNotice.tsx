/**
 * A tinted notice box (title + body) — a local stand-in for the design system's
 * `Banner`, which hasn't been built as a mobile primitive yet. Used by the
 * recovery screens for the "nothing was uploaded" / "every holder essential" /
 * success callouts. Kept here rather than in `components/` so it doesn't
 * pre-empt the eventual shared `Banner`.
 */
import {type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {Text} from '../../components';
import {useTheme} from '../../theme';

export type NoticeVariant = 'info' | 'success' | 'warning';

export interface InlineNoticeProps {
  variant?: NoticeVariant;
  title: string;
  children?: ReactNode;
}

export function InlineNotice({variant = 'info', title, children}: InlineNoticeProps) {
  const {colors, spacing, radius} = useTheme();

  const {bg, border, accent} = {
    info: {bg: colors.infoTint, border: colors.info, accent: colors.info},
    success: {bg: colors.successTint, border: colors.success, accent: colors.success},
    warning: {bg: colors.warningTint, border: colors.warning, accent: colors.warning},
  }[variant];

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: bg,
          borderColor: border,
          borderRadius: radius.md,
          padding: spacing.md,
          gap: spacing.xs,
        },
      ]}>
      <Text variant="label" color={accent}>
        {title}
      </Text>
      {children !== undefined && (
        <Text variant="caption" color={colors.textSecondary}>
          {children}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {borderWidth: 1},
});
