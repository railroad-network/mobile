/**
 * @format
 *
 * Local device profile (T1.2.8): nickname + biometric preference, persisted as
 * JSON through the SecureStore. Absent/corrupt reads fall back to `{}`, and
 * saves merge rather than overwrite.
 */
import {loadProfile, saveProfile} from '../src/wallet/profile';
import {SecureStoreKeys} from '../src/crypto/constants';
import type {SecureStore} from '../src/crypto/SecureStore';

class MemStore implements SecureStore {
  readonly map = new Map<string, Uint8Array>();
  async save(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, value);
  }
  async load(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}

test('an unset profile loads as empty', async () => {
  expect(await loadProfile(new MemStore())).toEqual({});
});

test('save then load round-trips', async () => {
  const store = new MemStore();
  await saveProfile({nickname: 'asa_wren', biometricEnabled: false}, store);
  expect(await loadProfile(store)).toEqual({nickname: 'asa_wren', biometricEnabled: false});
});

test('save merges into the existing profile', async () => {
  const store = new MemStore();
  await saveProfile({nickname: 'asa_wren'}, store);
  await saveProfile({biometricEnabled: true}, store);
  expect(await loadProfile(store)).toEqual({nickname: 'asa_wren', biometricEnabled: true});
});

test('a corrupt blob loads as empty', async () => {
  const store = new MemStore();
  await store.save(SecureStoreKeys.PROFILE, Uint8Array.from([0xff, 0x00, 0x01]));
  expect(await loadProfile(store)).toEqual({});
});
