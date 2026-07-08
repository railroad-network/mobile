module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['coverage/'],
  rules: {
    'react-hooks/exhaustive-deps': 'error',
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['react-native/Libraries/**'],
            message:
              'Import from the public "react-native" package entry point instead of internal Libraries paths.',
          },
        ],
      },
    ],
  },
};
