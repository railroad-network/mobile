/**
 * The {@link @notifee/react-native}-backed {@link Notifier} (T1.3.6).
 *
 * The only file that imports notifee. Registered in `index.js` via
 * {@link registerNotifier} so the rest of the app talks to the seam, not the
 * native module — which keeps notifee out of the Jest environment (it has no
 * mock there) and confines all platform detail to this file.
 *
 * Notifications go through a single Android channel; iOS has no channel concept.
 * Permission is requested lazily (when the user enables notifications), not at
 * launch.
 */
import notifee, {AndroidImportance, AuthorizationStatus} from '@notifee/react-native';

import type {NotificationContent, Notifier} from './Notifications';

/** The Android channel all local notifications post to. */
const CHANNEL_ID = 'rrn-ledger';
const CHANNEL_NAME = 'Payments';

class NotifeeNotifier implements Notifier {
  private channelReady = false;

  async requestPermission(): Promise<boolean> {
    const settings = await notifee.requestPermission();
    return (
      settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      settings.authorizationStatus === AuthorizationStatus.PROVISIONAL
    );
  }

  async ensureChannel(): Promise<void> {
    if (this.channelReady) {
      return;
    }
    // Idempotent on Android; a no-op that resolves on iOS.
    await notifee.createChannel({
      id: CHANNEL_ID,
      name: CHANNEL_NAME,
      importance: AndroidImportance.HIGH,
    });
    this.channelReady = true;
  }

  async display(content: NotificationContent): Promise<void> {
    await this.ensureChannel();
    await notifee.displayNotification({
      id: content.id,
      title: content.title,
      body: content.body,
      android: {
        channelId: CHANNEL_ID,
        pressAction: {id: 'default'},
        smallIcon: 'ic_launcher',
      },
    });
  }
}

/** Builds the notifee-backed notifier for registration in `index.js`. */
export function createNotifeeNotifier(): Notifier {
  return new NotifeeNotifier();
}
