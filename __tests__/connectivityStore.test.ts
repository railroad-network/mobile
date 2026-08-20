/**
 * @format
 *
 * The reachability store behind the connectivity indicator. It's a plain
 * observable (the `useSyncExternalStore` shape), so its contract — read the
 * current verdict, notify on change only, reset to `unknown` — is checked
 * without a renderer.
 */
import {
  getReachability,
  resetReachability,
  setReachability,
  subscribeReachability,
} from '../src/network/connectivityStore';

beforeEach(() => {
  resetReachability();
});

test('starts unknown', () => {
  expect(getReachability()).toBe('unknown');
});

test('reflects the last set verdict', () => {
  setReachability('reachable');
  expect(getReachability()).toBe('reachable');
  setReachability('unreachable');
  expect(getReachability()).toBe('unreachable');
});

test('notifies subscribers only on an actual change', () => {
  const listener = jest.fn();
  subscribeReachability(listener);

  setReachability('reachable');
  expect(listener).toHaveBeenCalledTimes(1);

  setReachability('reachable'); // no change
  expect(listener).toHaveBeenCalledTimes(1);

  setReachability('unreachable');
  expect(listener).toHaveBeenCalledTimes(2);
});

test('reset returns to unknown and notifies', () => {
  const listener = jest.fn();
  setReachability('unreachable');
  subscribeReachability(listener);

  resetReachability();
  expect(getReachability()).toBe('unknown');
  expect(listener).toHaveBeenCalledTimes(1);
});

test('an unsubscribed listener stops receiving updates', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeReachability(listener);

  setReachability('reachable');
  expect(listener).toHaveBeenCalledTimes(1);

  unsubscribe();
  setReachability('unreachable');
  expect(listener).toHaveBeenCalledTimes(1);
});
