import {useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {controlHeight, radius as radiusTokens, useTheme} from '../theme';
import {Text} from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  children: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

const HEIGHT: Record<ButtonSize, number> = {
  sm: controlHeight.sm,
  md: controlHeight.md,
  lg: controlHeight.lg,
};

/** The primary action primitive. Mirrors the design system's `Button`. */
export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  loading = false,
  iconLeft,
  iconRight,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const theme = useTheme();
  const {colors} = theme;
  const isDisabled = disabled || loading;
  // Track press state ourselves rather than using Pressable's function-form
  // `style`: NativeWind's JSX interop drops a function `style` prop entirely,
  // which would strip the button's fill and layout.
  const [pressed, setPressed] = useState(false);

  const palette = useMemo(() => {
    switch (variant) {
      case 'primary':
        return {bg: colors.primary, pressedBg: colors.primaryHover, text: colors.onPrimary, border: 'transparent'};
      case 'secondary':
        return {bg: colors.surfaceRaised, pressedBg: colors.surface, text: colors.text, border: colors.borderStrong};
      case 'ghost':
        return {bg: 'transparent', pressedBg: colors.primaryTint, text: colors.primary, border: 'transparent'};
      case 'danger':
        return {bg: colors.danger, pressedBg: colors.danger, text: colors.textOnPrimary, border: 'transparent'};
      case 'accent':
        return {bg: colors.accent, pressedBg: colors.accentStrong, text: colors.text, border: 'transparent'};
    }
  }, [variant, colors]);

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{disabled: isDisabled}}
      style={[
        styles.base,
        {
          height: HEIGHT[size],
          minWidth: HEIGHT[size],
          paddingHorizontal: theme.spacing.lg,
          borderRadius: radiusTokens.md,
          backgroundColor: pressed ? palette.pressedBg : palette.bg,
          borderWidth: palette.border === 'transparent' ? 0 : 1,
          borderColor: palette.border,
          opacity: isDisabled ? 0.5 : 1,
          width: fullWidth ? '100%' : undefined,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <>
          {iconLeft}
          <Text variant="label" style={{color: palette.text}}>
            {children}
          </Text>
          {iconRight}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
