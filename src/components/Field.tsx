import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import {controlHeight, useTheme} from '../theme';
import {Text} from './Text';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * A labelled text input — label, control, and hint/error stacked together
 * as one accessible unit. Matches the design system's `Input`.
 */
export function Field({
  label,
  hint,
  error,
  prefix,
  suffix,
  containerStyle,
  editable = true,
  ...rest
}: FieldProps) {
  const theme = useTheme();
  const {colors} = theme;
  const invalid = error !== undefined;

  return (
    <View style={[{gap: theme.spacing.xs}, containerStyle]}>
      {label !== undefined && (
        <Text variant="label" color={colors.text}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.controlBase,
          {
            height: controlHeight.md,
            paddingHorizontal: theme.spacing.md,
            gap: theme.spacing.sm,
            borderRadius: theme.radius.sm,
            borderColor: invalid ? colors.danger : colors.borderStrong,
            backgroundColor: editable ? colors.surfaceRaised : colors.surfaceSunken,
            opacity: editable ? 1 : 0.65,
          },
        ]}>
        {prefix}
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.textMuted}
          editable={editable}
          style={[styles.input, {fontSize: theme.type.body.fontSize, color: colors.text}]}
          {...rest}
        />
        {suffix}
      </View>
      {error !== undefined ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : hint !== undefined ? (
        <Text variant="caption" color={colors.textSecondary}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  controlBase: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
  },
});
