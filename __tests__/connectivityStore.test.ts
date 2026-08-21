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
  noteReachable,
  OFFLINE_AFTER_CONSECUTIVE_FAILURES,
  reportPass,
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

describe('reportPass (failure debounce)', () => {
  test('a good pass is online immediately', () => {
    reportPass(true);
    expect(getReachability()).toBe('reachable');
  });

  test('a single failed pass does not flip to offline (a reconnect blip)', () => {
    reportPass(true);
    reportPass(false);
    // Still online — one blip is tolerated, the prior verdict stands.
    expect(getReachability()).toBe('reachable');
  });

  test('enough failures in a row do show offline (a real outage)', () => {
    reportPass(true);
    for (let i = 0; i < OFFLINE_AFTER_CONSECUTIVE_FAILURES; i += 1) {
      reportPass(false);
    }
    expect(getReachability()).toBe('unreachable');
  });

  test('the first failed passes stay optimistically online from a cold start', () => {
    // No good pass yet (unknown). A lone failure must not flash offline.
    reportPass(false);
    expect(getReachability()).toBe('unknown');
  });

  test('a good pass resets the failure run', () => {
    reportPass(false); // 1 failure, not yet offline
    reportPass(true); // recovers, clears the run
    reportPass(false); // 1 failure again — must not be offline
    expect(getReachability()).not.toBe('unreachable');
  });

  test('recovering after going offline flips back online on the next good pass', () => {
    for (let i = 0; i < OFFLINE_AFTER_CONSECUTIVE_FAILURES; i += 1) {
      reportPass(false);
    }
    expect(getReachability()).toBe('unreachable');
    reportPass(true);
    expect(getReachability()).toBe('reachable');
  });

  test('reset clears the failure run so the next blip is judged fresh', () => {
    reportPass(false); // 1 failure toward the threshold
    resetReachability(); // teardown
    reportPass(false); // a fresh lone failure, not the second of a run
    expect(getReachability()).not.toBe('unreachable');
  });
});

describe('noteReachable (a read confirms reachability)', () => {
  test('resolves the initial unknown (connecting) straight to reachable', () => {
    expect(getReachability()).toBe('unknown');
    noteReachable();
    expect(getReachability()).toBe('reachable');
  });

  test('clears a failure run, so a pending subscribe blip cannot then flip offline', () => {
    reportPass(false); // 1 subscribe failure toward the threshold
    noteReachable(); // a read got through — we are reachable
    reportPass(false); // a fresh lone failure, not the second of a run
    expect(getReachability()).not.toBe('unreachable');
  });
});
