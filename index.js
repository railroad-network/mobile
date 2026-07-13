/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import { registerNativeRrnCryptoFfi } from './src/crypto/registerNativeFfi';

// Wire the real Rust crypto bindings into the seam before anything renders, so
// wallet/crypto code (which reaches the FFI through getRrnCryptoFfi) works
// on-device. Tests register their own in-memory fake instead.
registerNativeRrnCryptoFfi();

AppRegistry.registerComponent(appName, () => App);
