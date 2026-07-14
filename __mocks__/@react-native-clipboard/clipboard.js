/**
 * Jest mock for @react-native-clipboard/clipboard — the native module can't load
 * under Jest. Auto-applied for node_modules (like the qrcode-svg / vision-camera
 * mocks). `setString` records the last copied value so tests can assert copies.
 */
let lastString = '';

module.exports = {
  __esModule: true,
  default: {
    setString: jest.fn(value => {
      lastString = value;
    }),
    getString: jest.fn(() => Promise.resolve(lastString)),
    hasString: jest.fn(() => Promise.resolve(lastString.length > 0)),
  },
};
