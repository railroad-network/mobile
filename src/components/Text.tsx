import {Text as RNText, type TextProps as RNTextProps} from 'react-native';

import {useTheme, type TypeScale} from '../theme';

export type TextVariant = keyof TypeScale;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
}

/**
 * The body-copy primitive. Reads its size/weight/family from the theme's
 * type scale (`theme.type`) rather than ad hoc numbers — every screen's
 * running text should go through this instead of RN's bare `Text`.
 */
export function Text({variant = 'body', color, style, ...rest}: TextProps) {
  const theme = useTheme();
  const typeStyle = theme.type[variant];

  return (
    <RNText
      style={[
        {
          fontFamily: typeStyle.fontFamily,
          fontSize: typeStyle.fontSize,
          lineHeight: typeStyle.lineHeight,
          fontWeight: typeStyle.fontWeight,
          letterSpacing: typeStyle.letterSpacing,
          color: color ?? theme.colors.text,
        },
        style,
      ]}
      {...rest}
    />
  );
}
