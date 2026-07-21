/**
 * The local-notifications seam (T1.3.6).
 *
 * Like {@link network/Discovery} and the crypto FFI, the native notification
 * library ({@link @notifee/react-native}) is reached only through this seam. The
 * real implementation is registered once at startup in `index.js`; unit tests
 * register a fake (or leave it unset). Nothing else in the app imports notifee
 * directly, so the pure logic — which event becomes which notification, gated by
 * the user's preferences — stays testable without a native module.
 *
 * A missing notifier (no registration) is not an error: it just means no
 * notification is shown. That keeps the app running under Jest and degrades
 * gracefully if the platform has no notification support.
 */

/** The rendered content of one local notification. */
export interface NotificationContent {
  /** Stable id so re-delivering the same event replaces rather than stacks. */
  id: string;
  /** The bold first line. */
  title: string;
  /** The body line. */
  body: string;
}

/**
 * What the app needs from a notification backend. Kept tiny: request permission,
 * make sure the Android channel exists, and display one notification.
 */
export interface Notifier {
  /** Asks the OS for notification permission; resolves to whether it is granted. */
  requestPermission(): Promise<boolean>;
  /** Idempotently creates the Android notification channel (no-op on iOS). */
  ensureChannel(): Promise<void>;
  /** Displays a local notification. */
  display(content: NotificationContent): Promise<void>;
}

let notifier: Notifier | null = null;

/** Registers the process-wide notifier (called once from `index.js`). */
export function registerNotifier(impl: Notifier): void {
  notifier = impl;
}

/** The registered notifier, or `null` if none has been registered. */
export function getNotifier(): Notifier | null {
  return notifier;
}

/** Test hook: clears the registered notifier. */
export function resetNotifierForTests(): void {
  notifier = null;
}
