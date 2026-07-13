/**
 * Jest stand-in for `react-native-vision-camera`, a native module (and its
 * Nitro dependencies) that cannot load under Jest.
 *
 * Defaults are the happy path: camera permission granted, a back camera
 * present, and `<Camera>` rendered as a plain view. Tests that need to drive
 * permission states or simulate a scan should `jest.mock` this module with
 * their own implementation (see QRScanner.test.tsx).
 */
const React = require('react');
const {View} = require('react-native');

const useCameraPermission = () => ({
  hasPermission: true,
  requestPermission: async () => true,
  canRequestPermission: true,
  status: 'authorized',
});

const useCameraDevice = () => ({id: 'mock-back-camera', position: 'back'});

const useObjectOutput = () => ({});

const isScannedCode = object => object != null && 'value' in object;

function Camera() {
  return React.createElement(View, {
    testID: 'qr-camera',
    accessibilityLabel: 'QR scanner camera',
  });
}

module.exports = {
  Camera,
  useCameraPermission,
  useCameraDevice,
  useObjectOutput,
  isScannedCode,
};
