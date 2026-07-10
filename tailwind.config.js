/**
 * NativeWind config. Utility classes here are for static, non-themed layout
 * (spacing/flex/etc.) — color-dependent, light/dark-aware styling in the
 * primitives (`src/components/`) goes through `useTheme()` instead, since
 * that's what actually switches at runtime with the OS appearance setting.
 *
 * The `colors` below are the *light* palette only, kept in sync by hand with
 * `src/theme/colors.ts` (the source of truth, also used by `useTheme()`).
 */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#FBF8F2',
        surface: '#F4EEE3',
        'surface-raised': '#FFFFFF',
        'surface-sunken': '#EAE1D2',
        text: '#211B14',
        'text-secondary': '#5C5346',
        'text-muted': '#897E6D',
        border: '#D9CEBC',
        'border-strong': '#C2B49C',
        primary: '#1E5038',
        accent: '#C77D27',
        credit: '#1E5038',
        debit: '#9C331C',
        success: '#1E5038',
        warning: '#A65A18',
        danger: '#9C331C',
        info: '#2F586E',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
    },
  },
  plugins: [],
};
