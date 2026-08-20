/**
 * Jest stand-in for `react-native-vision-camera`, a native module (and its
 * Nitro dependencies) that cannot load under Jest.
 *
 * The app uses this library only for its cross-platform camera-permission gate
 * and device lookup (scanning itself is `react-native-camera-kit`, mocked
 * separately). Defaults are the happy path: permission granted, a back camera
 * present. Tests that need to drive permission states should `jest.mock` this
 * module with their own implementation (see QRScanner.test.tsx).
 */
const useCameraPermission = () => ({
  hasPermission: true,
  requestPermission: async () => true,
  canRequestPermission: true,
  status: 'authorized',
});

const useCameraDevice = () => ({id: 'mock-back-camera', position: 'back'});

module.exports = {
  useCameraPermission,
  useCameraDevice,
};
