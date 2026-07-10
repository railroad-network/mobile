import {type ColorTokens, darkColors, lightColors} from './colors';
import {radius, type RadiusTokens} from './radius';
import {spacing, type SpacingTokens} from './spacing';
import {typeScale, type TypeScale} from './typography';

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  scheme: ColorScheme;
  colors: ColorTokens;
  spacing: SpacingTokens;
  radius: RadiusTokens;
  type: TypeScale;
}

export const lightTheme: Theme = {
  scheme: 'light',
  colors: lightColors,
  spacing,
  radius,
  type: typeScale,
};

export const darkTheme: Theme = {
  scheme: 'dark',
  colors: darkColors,
  spacing,
  radius,
  type: typeScale,
};
