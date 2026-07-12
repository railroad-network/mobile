/**
 * @format
 */
import {Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';

import {getSecureStore} from '../src/crypto/SecureStore';
import {SecureStoreKeys} from '../src/crypto/constants';

// In-memory fake of react-native-keychain: enough of the enum surface the
// implementation references, plus a Map-backed store keyed by `service`.
// `__setFailHardware` simulates a device without secure hardware so the Android
// fallback path can be exercised.
jest.mock('react-native-keychain', () => {
  const store = new Map<string, {username: string; password: string}>();
  let failHardware = false;
  const svc = (o?: {service?: string}) => (o && o.service) || '__default__';
  return {
    ACCESSIBLE: {
      WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    },
    ACCESS_CONTROL: {BIOMETRY_ANY: 'BiometryAny'},
    SECURITY_LEVEL: {SECURE_SOFTWARE: 0, SECURE_HARDWARE: 1, ANY: 2},
    STORAGE_TYPE: {AES_GCM: 'KeystoreAESGCM'},
    setGenericPassword: jest.fn(
      async (
        username: string,
        password: string,
        options: {service?: string; securityLevel?: number} = {},
      ) => {
        if (failHardware && options.securityLevel === 1) {
          throw new Error('secure hardware unavailable');
        }
        store.set(svc(options), {username, password});
        return {service: options.service, storage: 'KeystoreAESGCM'};
      },
    ),
    getGenericPassword: jest.fn(async (options: {service?: string} = {}) => {
      const entry = store.get(svc(options));
      return entry ? {...entry, service: svc(options)} : false;
    }),
    resetGenericPassword: jest.fn(async (options: {service?: string} = {}) =>
      store.delete(svc(options)),
    ),
    hasGenericPassword: jest.fn(async (options: {service?: string} = {}) =>
      store.has(svc(options)),
    ),
    __reset: () => {
      store.clear();
      failHardware = false;
    },
    __setFailHardware: (v: boolean) => {
      failHardware = v;
    },
  };
});

// Typed handle to the mock's test-only controls.
const mock = Keychain as unknown as {
  __reset: () => void;
  __setFailHardware: (v: boolean) => void;
  setGenericPassword: jest.Mock;
};

const setPlatform = (os: 'ios' | 'android') => {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true});
};

describe('SecureStore', () => {
  const secret = Uint8Array.from([1, 2, 3, 250, 251, 252, 0, 255]);

  beforeEach(() => {
    mock.__reset();
    jest.clearAllMocks();
    setPlatform('ios');
  });

  test('save then load returns identical bytes', async () => {
    const store = getSecureStore();
    await store.save(SecureStoreKeys.WALLET_SECRET, secret);
    const loaded = await store.load(SecureStoreKeys.WALLET_SECRET);
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded!)).toEqual(Array.from(secret));
  });

  test('save then delete then load returns null', async () => {
    const store = getSecureStore();
    await store.save(SecureStoreKeys.WALLET_SECRET, secret);
    await store.delete(SecureStoreKeys.WALLET_SECRET);
    expect(await store.load(SecureStoreKeys.WALLET_SECRET)).toBeNull();
  });

  test('load of an absent key returns null', async () => {
    expect(await getSecureStore().load(SecureStoreKeys.STATION_PAIRING_TOKEN)).toBeNull();
  });

  test('has reflects presence and absence without a biometric read', async () => {
    const store = getSecureStore();
    expect(await store.has(SecureStoreKeys.RECOVERY_SHARDS)).toBe(false);
    await store.save(SecureStoreKeys.RECOVERY_SHARDS, secret);
    expect(await store.has(SecureStoreKeys.RECOVERY_SHARDS)).toBe(true);
    // `has` must not decrypt (no biometric prompt) — it never reads the value.
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  });

  test('distinct keys are isolated', async () => {
    const store = getSecureStore();
    const other = Uint8Array.from([9, 9, 9]);
    await store.save(SecureStoreKeys.WALLET_SECRET, secret);
    await store.save(SecureStoreKeys.STATION_PAIRING_TOKEN, other);
    expect(Array.from((await store.load(SecureStoreKeys.WALLET_SECRET))!)).toEqual(
      Array.from(secret),
    );
    expect(
      Array.from((await store.load(SecureStoreKeys.STATION_PAIRING_TOKEN))!),
    ).toEqual(Array.from(other));
  });

  test('iOS save requests device-only accessibility and biometric access control', async () => {
    await getSecureStore().save(SecureStoreKeys.WALLET_SECRET, secret);
    const options = mock.setGenericPassword.mock.calls[0][2];
    expect(options.accessible).toBe(
      Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    );
    expect(options.accessControl).toBe(Keychain.ACCESS_CONTROL.BIOMETRY_ANY);
  });

  test('Android save prefers secure hardware, then falls back to software', async () => {
    setPlatform('android');
    mock.__setFailHardware(true);
    const store = getSecureStore();

    await store.save(SecureStoreKeys.WALLET_SECRET, secret);

    // Two attempts: hardware (rejected) then software (accepted).
    const levels = mock.setGenericPassword.mock.calls.map(c => c[2].securityLevel);
    expect(levels).toEqual([
      Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
      Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
    ]);
    // And the value is still retrievable after the fallback.
    expect(Array.from((await store.load(SecureStoreKeys.WALLET_SECRET))!)).toEqual(
      Array.from(secret),
    );
  });

  test('Android save uses hardware directly when available (no fallback)', async () => {
    setPlatform('android');
    await getSecureStore().save(SecureStoreKeys.WALLET_SECRET, secret);
    expect(mock.setGenericPassword).toHaveBeenCalledTimes(1);
    expect(mock.setGenericPassword.mock.calls[0][2].securityLevel).toBe(
      Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    );
  });

  test('opting out of biometrics omits the biometric access control (iOS)', async () => {
    await getSecureStore().save(SecureStoreKeys.WALLET_FILE, secret, {
      requireBiometric: false,
    });
    const options = mock.setGenericPassword.mock.calls[0][2];
    // Device-only accessibility still applies; only the biometric gate is dropped.
    expect(options.accessible).toBe(
      Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    );
    expect(options.accessControl).toBeUndefined();
    // The bytes are still retrievable.
    expect(Array.from((await getSecureStore().load(SecureStoreKeys.WALLET_FILE))!)).toEqual(
      Array.from(secret),
    );
  });

  test('opting out of biometrics omits the biometric access control (Android)', async () => {
    setPlatform('android');
    await getSecureStore().save(SecureStoreKeys.WALLET_FILE, secret, {
      requireBiometric: false,
    });
    const options = mock.setGenericPassword.mock.calls[0][2];
    expect(options.accessControl).toBeUndefined();
    expect(options.storage).toBe(Keychain.STORAGE_TYPE.AES_GCM);
  });

  test('biometrics required by default when no option is passed', async () => {
    await getSecureStore().save(SecureStoreKeys.WALLET_FILE, secret);
    expect(mock.setGenericPassword.mock.calls[0][2].accessControl).toBe(
      Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
    );
  });
});
