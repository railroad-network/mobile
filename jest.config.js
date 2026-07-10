module.exports = {
  preset: '@react-native/jest-preset',
  // NativeWind's global.css (imported by src/App.tsx) has no meaning under
  // Jest — there's no Metro/PostCSS pipeline here, just JS module resolution.
  moduleNameMapper: {
    '\\.css$': '<rootDir>/__mocks__/styleMock.js',
  },
  // react-native-css-interop (NativeWind's runtime) ships untranspiled
  // TS/JSX as its "react-native" entry point; the RN preset's default
  // pattern only allows-lists react-native itself, so extend it.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-.*|nativewind)/)',
  ],
};
