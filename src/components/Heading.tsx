import {type TextProps as RNTextProps} from 'react-native';

import {Text} from './Text';

export type HeadingLevel = 'displayLarge' | 'displayMedium' | 'headingLarge' | 'headingMedium' | 'headingSmall';

export interface HeadingProps extends Omit<RNTextProps, 'style'> {
  level?: HeadingLevel;
  color?: string;
  style?: RNTextProps['style'];
}

/**
 * A heading/display-copy primitive — the `Text` primitive restricted to the
 * type scale's heading roles, with `accessibilityRole="header"` set so
 * screen readers can navigate by heading.
 */
export function Heading({level = 'headingMedium', ...rest}: HeadingProps) {
  return <Text variant={level} accessibilityRole="header" {...rest} />;
}
