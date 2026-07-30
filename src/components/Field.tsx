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
  multiline,
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
          // A single-line control is a fixed row with the text centred; a
          // multiline one grows from a taller minimum, aligns its content to the
          // top, and pads top and bottom so the text isn't pinned to the border.
          multiline
            ? {minHeight: controlHeight.md * 4, alignItems: 'flex-start', paddingVertical: theme.spacing.sm}
            : {height: controlHeight.md, alignItems: 'center'},
          {
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
          multiline={multiline}
          // Android centres multiline text vertically by default; top-align it so
          // it fills from the top of the taller box.
          textAlignVertical={multiline ? 'top' : undefined}
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
    borderWidth: 1,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
  },
});
