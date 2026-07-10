import {Platform} from 'react-native';

/**
 * Type scale, translated from the design system's `tokens/typography.css`
 * and `tokens/fonts.css`. The web kit applied type ad hoc per screen (no
 * reusable component); this is the canonical RN scale `Heading`/`Text`
 * build against.
 *
 * Font families are deferred to system defaults for now — T1.2.1 explicitly
 * scopes custom fonts out. The design system ships the real faces (Zilla
 * Slab / Atkinson Hyperlegible / IBM Plex Mono, `assets/fonts/*.woff2`);
 * swapping `fontFamily.display`/`sans`/`mono` below to the linked native
 * fonts is a later, self-contained change.
 */
export const fontFamily = {
  display: Platform.select({ios: undefined, android: undefined, default: undefined}),
  sans: Platform.select({ios: undefined, android: undefined, default: undefined}),
  mono: Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'}),
};

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export interface TypeStyle {
  fontFamily?: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing?: number;
}

export interface TypeScale {
  displayLarge: TypeStyle;
  displayMedium: TypeStyle;
  headingLarge: TypeStyle;
  headingMedium: TypeStyle;
  headingSmall: TypeStyle;
  bodyLarge: TypeStyle;
  body: TypeStyle;
  label: TypeStyle;
  caption: TypeStyle;
  mono: TypeStyle;
}

export const typeScale: TypeScale = {
  displayLarge: {
    fontFamily: fontFamily.display,
    fontSize: 60,
    lineHeight: 69,
    fontWeight: fontWeight.semibold,
  },
  displayMedium: {
    fontFamily: fontFamily.display,
    fontSize: 48,
    lineHeight: 55,
    fontWeight: fontWeight.semibold,
  },
  headingLarge: {
    fontFamily: fontFamily.display,
    fontSize: 36,
    lineHeight: 43,
    fontWeight: fontWeight.semibold,
  },
  headingMedium: {
    fontFamily: fontFamily.display,
    fontSize: 30,
    lineHeight: 35,
    fontWeight: fontWeight.semibold,
  },
  headingSmall: {
    fontFamily: fontFamily.display,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: fontWeight.semibold,
  },
  bodyLarge: {
    fontFamily: fontFamily.sans,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: fontWeight.regular,
  },
  body: {
    fontFamily: fontFamily.sans,
    fontSize: 16,
    lineHeight: 25,
    fontWeight: fontWeight.regular,
  },
  label: {
    fontFamily: fontFamily.sans,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeight.bold,
  },
  caption: {
    fontFamily: fontFamily.sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeight.regular,
  },
  mono: {
    fontFamily: fontFamily.mono,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeight.medium,
  },
};
