/**
 * Jest stand-in for `react-native-qrcode-svg`, which pulls in the native
 * `react-native-svg` module that can't load under Jest. Renders a plain view
 * carrying the encoded value so tests can assert what the QR would encode.
 */
const React = require('react');
const {View} = require('react-native');

module.exports = function QRCode({value, size}) {
  return React.createElement(View, {
    testID: 'qr-code',
    accessibilityLabel: `QR code for ${value}`,
    'data-value': value,
    style: {width: size, height: size},
  });
};
module.exports.default = module.exports;
