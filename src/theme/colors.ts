/**
 * Color tokens — translated 1:1 from the Railroad Network Design System
 * (`tokens/colors.css`'s semantic aliases; light = `:root`,
 * dark = `[data-theme="night"]`). Components reference these semantic names,
 * never a raw hex — matches the design system's own rule.
 */
export interface ColorTokens {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  textOnPrimary: string;
  textLink: string;

  border: string;
  borderStrong: string;
  borderInk: string;

  primary: string;
  primaryHover: string;
  primaryActive: string;
  primaryTint: string;
  onPrimary: string;

  accent: string;
  accentStrong: string;
  accentTint: string;

  credit: string;
  creditTint: string;
  debit: string;
  debitTint: string;

  success: string;
  successTint: string;
  warning: string;
  warningTint: string;
  danger: string;
  dangerTint: string;
  info: string;
  infoTint: string;

  focusRing: string;
  focusRingSoft: string;
  scrim: string;
}

export const lightColors: ColorTokens = {
  bg: '#FBF8F2',
  surface: '#F4EEE3',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#EAE1D2',

  text: '#211B14',
  textSecondary: '#5C5346',
  textMuted: '#897E6D',
  textInverse: '#FBF8F2',
  textOnPrimary: '#FBF8F2',
  textLink: '#1E5038',

  border: '#D9CEBC',
  borderStrong: '#C2B49C',
  borderInk: '#3B342B',

  primary: '#1E5038',
  primaryHover: '#143A29',
  primaryActive: '#102E20',
  primaryTint: '#D7E7DD',
  onPrimary: '#FBF8F2',

  accent: '#C77D27',
  accentStrong: '#A65A18',
  accentTint: '#F6E5C9',

  credit: '#1E5038',
  creditTint: '#EAF2EC',
  debit: '#9C331C',
  debitTint: '#F9E7E0',

  success: '#1E5038',
  successTint: '#EAF2EC',
  warning: '#A65A18',
  warningTint: '#FBF1DD',
  danger: '#9C331C',
  dangerTint: '#F9E7E0',
  info: '#2F586E',
  infoTint: '#E8EFF3',

  focusRing: '#C77D27',
  focusRingSoft: 'rgba(199, 125, 39, 0.40)',
  scrim: 'rgba(33, 27, 20, 0.55)',
};

/** The design system's "night" theme — travel by night, follow the North Star. */
export const darkColors: ColorTokens = {
  bg: '#16130F',
  surface: '#211C16',
  surfaceRaised: '#2A241C',
  surfaceSunken: '#100D0A',

  text: '#F2EAD9',
  textSecondary: '#C3B8A4',
  textMuted: '#8B8170',
  textInverse: '#211B14',
  textOnPrimary: '#0C0A07',
  textLink: '#6BA888',

  border: '#38301F',
  borderStrong: '#4C4230',
  borderInk: '#57503F',

  primary: '#3E8A63',
  primaryHover: '#6BA888',
  primaryActive: '#8FBFA4',
  primaryTint: '#1B3026',
  onPrimary: '#0C0A07',

  accent: '#E0A24A',
  accentStrong: '#E0A24A',
  accentTint: '#3A2A12',

  credit: '#6BA888',
  creditTint: '#16271D',
  debit: '#E07B5E',
  debitTint: '#311510',

  success: '#6BA888',
  successTint: '#16271D',
  warning: '#E0A24A',
  warningTint: '#312413',
  danger: '#E07B5E',
  dangerTint: '#311510',
  info: '#3D6E88',
  infoTint: '#15252E',

  focusRing: '#E0A24A',
  focusRingSoft: 'rgba(224, 162, 74, 0.45)',
  scrim: 'rgba(8, 6, 4, 0.66)',
};
