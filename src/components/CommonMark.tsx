/**
 * CommonMark — the unit glyph of the Common (the platform's credit unit): a C
 * cupping the four-point North Star. Rendered from the design system's exact
 * `common-symbol` geometry. Takes on the color it is given (green credit / red
 * debit inside an {@link Amount}); defaults to the running text color.
 */
import Svg, {Path, Polygon} from 'react-native-svg';

import {useTheme} from '../theme';

export interface CommonMarkProps {
  /** Edge length in points. Sized to sit alongside text. */
  size?: number;
  /** Glyph color. Defaults to the theme's text color. */
  color?: string;
}

export function CommonMark({size = 14, color}: CommonMarkProps) {
  const theme = useTheme();
  const fill = color ?? theme.colors.text;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path
        d="M72.07 27.71 A30 30 0 1 0 72.07 72.29"
        fill="none"
        stroke={fill}
        strokeWidth={10.5}
        strokeLinecap="round"
      />
      <Polygon
        fill={fill}
        points="50,33 54.53,45.47 67,50 54.53,54.53 50,67 45.47,54.53 33,50 45.47,45.47"
      />
    </Svg>
  );
}
