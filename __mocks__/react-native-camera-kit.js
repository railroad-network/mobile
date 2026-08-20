/**
 * Jest stand-in for `react-native-camera-kit`, whose Fabric native component
 * cannot load under Jest ("Could not find component config for native
 * component"). This is the QR-scanning camera behind the `<QRScanner>` seam.
 *
 * Default is the happy path: `<Camera>` renders as a plain view. Tests that need
 * to simulate a scan should `jest.mock` this module with their own
 * implementation that captures `onReadCode` (see QRScanner.test.tsx).
 */
const React = require('react');
const {View} = require('react-native');

const CameraType = {Back: 'back', Front: 'front'};

function Camera() {
  return React.createElement(View, {
    testID: 'qr-camera',
    accessibilityLabel: 'QR scanner camera',
  });
}

module.exports = {
  __esModule: true,
  default: {Camera, CameraType},
  Camera,
  CameraType,
};
