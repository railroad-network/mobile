/** Corner radius tokens (dp), translated from `tokens/radius.css`. */
export interface RadiusTokens {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

export const radius: RadiusTokens = {
  sm: 4, // inputs, small controls
  md: 6, // buttons
  lg: 8, // cards
  xl: 12, // panels / dialogs
  full: 9999, // chips, avatars, switches
};
