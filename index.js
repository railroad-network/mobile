/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import { registerNativeRrnCryptoFfi } from './src/crypto/registerNativeFfi';
import { createStationDiscovery } from 'rrn-discovery';
import { registerStationDiscovery } from './src/network/Discovery';

// Wire the real Rust crypto bindings into the seam before anything renders, so
// wallet/crypto code (which reaches the FFI through getRrnCryptoFfi) works
// on-device. Tests register their own in-memory fake instead.
registerNativeRrnCryptoFfi();

// Same idea for mDNS discovery: the seam is handed the real native browser
// here, and a fake in tests. Passing the factory rather than calling it keeps
// startup from touching native for a screen the user may never open.
registerStationDiscovery(createStationDiscovery);

AppRegistry.registerComponent(appName, () => App);
