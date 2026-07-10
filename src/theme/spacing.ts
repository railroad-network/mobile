/**
 * Spacing tokens (dp) — a subset of the design system's 4px-grid scale
 * (`tokens/spacing.css`: space-1, space-2, space-4, space-6, space-8).
 */
export interface SpacingTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

export const spacing: SpacingTokens = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

/** Minimum interactive target — never below 44dp (WCAG 2.5.5). */
export const tapMin = 44;

/** Control heights, matching the design system's `--control-*` tokens. */
export const controlHeight = {
  sm: 32,
  md: 44,
  lg: 52,
};
