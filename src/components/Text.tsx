import {StyleSheet, Text as RNText, type TextProps as RNTextProps} from 'react-native';

import {useTheme, type TypeScale} from '../theme';

export type TextVariant = keyof TypeScale;

/** Smallest line-box-to-font-size ratio that still renders a glyph uncropped. */
const MIN_LINE_RATIO = 1.05;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
}

/**
 * The body-copy primitive. Reads its size/weight/family from the theme's
 * type scale (`theme.type`) rather than ad hoc numbers — every screen's
 * running text should go through this instead of RN's bare `Text`.
 *
 * A `style` that overrides `fontSize` upwards without also giving a `lineHeight`
 * keeps the variant's line box, which clips the taller glyphs once the text
 * outgrows it. Such a style gets a line box scaled to the variant's own
 * proportion instead. Styles that still fit their variant's line box are left
 * alone, and an explicit `lineHeight` always wins.
 */
export function Text({variant = 'body', color, style, ...rest}: TextProps) {
  const theme = useTheme();
  const typeStyle = theme.type[variant];
  const override = StyleSheet.flatten(style);
  const overrideSize = override?.fontSize;

  const scaledLineHeight =
    typeof overrideSize === 'number' &&
    override.lineHeight === undefined &&
    overrideSize * MIN_LINE_RATIO > typeStyle.lineHeight
      ? {lineHeight: Math.round(overrideSize * (typeStyle.lineHeight / typeStyle.fontSize))}
      : null;

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
        scaledLineHeight,
      ]}
      {...rest}
    />
  );
}
