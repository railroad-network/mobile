/**
 * Secure, OS-level storage for the wallet's secret key and other sensitive
 * bytes (M1.1 T1.1.2).
 *
 * One TS API over two platform backends, both provided by
 * `react-native-keychain`:
 *   - **iOS**: the Keychain, pinned to this device, released only while the
 *     device is unlocked, and gated behind Face ID / Touch ID.
 *   - **Android**: the Keystore, preferring hardware-backed keys (TEE / secure
 *     element) and falling back to software-backed, again biometric-gated.
 *
 * The bytes are stored base64-encoded (Keychain stores strings); each logical
 * key maps to its own keychain `service` so entries are isolated and
 * individually deletable.
 *
 * This is only the *at-rest OS protection*. The wallet secret is additionally
 * passphrase-encrypted before it ever reaches here (the `.rrnwallet` format,
 * T1.1.5) — so Keychain extraction alone does not yield the key. See
 * `docs/threat-model` (mobile SecureStore).
 */
import {Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';

import {base64ToBytes, bytesToBase64} from './base64';

/** Options controlling how an entry is protected at rest. */
export interface SaveOptions {
  /**
   * Gate reads of this entry behind biometric authentication (Face ID / Touch
   * ID / fingerprint). Defaults to `true` — the wallet's convenience unlock.
   * Pass `false` when the user has opted out of biometrics during onboarding;
   * the entry is then protected only by device-unlock (plus, for the wallet,
   * the passphrase layer that guards the bytes themselves).
   */
  requireBiometric?: boolean;
}

export interface SecureStore {
  /** Stores `value` under `key`, replacing any existing entry. */
  save(key: string, value: Uint8Array, options?: SaveOptions): Promise<void>;
  /** Returns the bytes stored under `key`, or `null` if none. May prompt for
   * biometric authentication (the OS renders that UI, not us). */
  load(key: string): Promise<Uint8Array | null>;
  /** Removes the entry under `key`. A no-op if it does not exist. */
  delete(key: string): Promise<void>;
  /** Whether an entry exists under `key`. Does not decrypt, so it does not
   * trigger a biometric prompt. */
  has(key: string): Promise<boolean>;
}

// The OS renders the biometric dialog; we only supply its copy. We never draw
// our own authentication UI (a fake prompt is a phishing vector).
const AUTH_PROMPT: Keychain.AuthenticationPrompt = {
  title: 'Unlock Railroad Network',
  cancel: 'Cancel',
};

/**
 * Backed by `react-native-keychain`. A single implementation that varies only
 * its per-platform options; iOS and Android share the save/load/delete/has
 * control flow.
 */
class KeychainSecureStore implements SecureStore {
  async save(
    key: string,
    value: Uint8Array,
    options: SaveOptions = {},
  ): Promise<void> {
    const {requireBiometric = true} = options;
    const password = bytesToBase64(value);

    if (Platform.OS === 'android') {
      // Prefer hardware-backed storage; fall back to software-backed if the
      // device has no secure hardware (setGenericPassword rejects in that case).
      try {
        await Keychain.setGenericPassword(
          key,
          password,
          this.androidOptions(
            key,
            Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
            requireBiometric,
          ),
        );
      } catch {
        await Keychain.setGenericPassword(
          key,
          password,
          this.androidOptions(
            key,
            Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
            requireBiometric,
          ),
        );
      }
      return;
    }

    await Keychain.setGenericPassword(
      key,
      password,
      this.iosOptions(key, requireBiometric),
    );
  }

  async load(key: string): Promise<Uint8Array | null> {
    const result = await Keychain.getGenericPassword({
      service: key,
      authenticationPrompt: AUTH_PROMPT,
    });
    if (!result) {
      return null;
    }
    return base64ToBytes(result.password);
  }

  async delete(key: string): Promise<void> {
    await Keychain.resetGenericPassword({service: key});
  }

  async has(key: string): Promise<boolean> {
    return Keychain.hasGenericPassword({service: key});
  }

  private iosOptions(key: string, requireBiometric: boolean): Keychain.SetOptions {
    return {
      service: key,
      // Require the device to be unlocked, and never sync to iCloud / migrate
      // to another device.
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      // Gate access behind Face ID / Touch ID when the user opted in; otherwise
      // device-unlock alone guards the (still passphrase-encrypted) bytes.
      ...(requireBiometric
        ? {accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY}
        : {}),
    };
  }

  private androidOptions(
    key: string,
    securityLevel: Keychain.SECURITY_LEVEL,
    requireBiometric: boolean,
  ): Keychain.SetOptions {
    return {
      service: key,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
      securityLevel,
      // AES-GCM keystore entry, gated behind biometric authentication when the
      // user opted in.
      storage: Keychain.STORAGE_TYPE.AES_GCM,
      ...(requireBiometric
        ? {accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY}
        : {}),
    };
  }
}

let instance: SecureStore | null = null;

/** Returns the process-wide {@link SecureStore}. */
export function getSecureStore(): SecureStore {
  if (instance === null) {
    instance = new KeychainSecureStore();
  }
  return instance;
}
