/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import { registerNativeRrnCryptoFfi } from './src/crypto/registerNativeFfi';
import { createStationDiscovery } from 'rrn-discovery';
import { registerStationDiscovery } from './src/network/Discovery';
import { registerNotifier } from './src/notifications/Notifications';
import { createNotifeeNotifier } from './src/notifications/notifeeNotifier';
import { registerBackgroundFetch } from './src/network/registerBackgroundFetch';

// Wire the real Rust crypto bindings into the seam before anything renders, so
// wallet/crypto code (which reaches the FFI through getRrnCryptoFfi) works
// on-device. Tests register their own in-memory fake instead.
registerNativeRrnCryptoFfi();

// Same idea for mDNS discovery: the seam is handed the real native browser
// here, and a fake in tests. Passing the factory rather than calling it keeps
// startup from touching native for a screen the user may never open.
registerStationDiscovery(createStationDiscovery);

// Local notifications (T1.3.6): hand the seam the notifee-backed notifier so the
// app can request permission and display alerts. Tests register a fake instead.
registerNotifier(createNotifeeNotifier());

// Background sync (T1.3.6): schedule periodic wakes and register the killed-app
// headless task, both of which drain queued station events and raise local
// notifications. The headless registration must happen at module load, before
// the component mounts, so a killed app can still be woken.
registerBackgroundFetch();

AppRegistry.registerComponent(appName, () => App);
