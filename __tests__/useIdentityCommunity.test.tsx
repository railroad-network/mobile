/**
 * @format
 *
 * useIdentity fills `community` from the station's whoami when paired, and
 * still yields a valid identity when unpaired or unreachable (T1.4.1). The
 * Community tab renders this field, so it must actually be populated by the
 * real hook — the screen tests mock useIdentity and would not catch a gap.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {useIdentity} from '../src/ledger';

const mockWhoami = jest.fn();
let mockClient: {whoami: jest.Mock} | null = null;

jest.mock('../src/network/useStation', () => ({
  ...jest.requireActual('../src/network/useStation'),
  useStationClient: () => mockClient,
  useActiveStation: () => null,
}));

jest.mock('../src/wallet/WalletSession', () => ({
  ...jest.requireActual('../src/wallet/WalletSession'),
  useWalletSession: () => ({wallet: {address: 'rrn1qmemember'}}),
}));

function Probe({onData}: {onData: (identity: unknown) => void}) {
  const {data} = useIdentity();
  if (data !== undefined) {
    onData(data);
  }
  return null;
}

async function renderProbe(onData: (identity: unknown) => void): Promise<void> {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  let received = false;
  const capture = (identity: unknown) => {
    received = true;
    onData(identity);
  };
  await act(async () => {
    ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <Probe onData={capture} />
      </QueryClientProvider>,
    );
  });
  // The async queryFn resolves over several turns, and react-query may notify
  // on a macrotask — flush real timer ticks until the probe has seen data
  // (bounded so a genuine failure still fails fast).
  for (let i = 0; i < 20 && !received; i++) {
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 0));
    });
  }
}

beforeEach(() => {
  mockWhoami.mockReset();
  mockClient = {whoami: mockWhoami};
});

test('fills community from whoami when paired', async () => {
  mockWhoami.mockResolvedValue({address: 'rrn1station', community: 'rrn-phase0'});
  let identity: any;
  await renderProbe(d => (identity = d));
  expect(identity).toMatchObject({address: 'rrn1qmemember', community: 'rrn-phase0'});
});

test('yields the identity without a community when unpaired', async () => {
  mockClient = null;
  let identity: any;
  await renderProbe(d => (identity = d));
  expect(identity.address).toBe('rrn1qmemember');
  expect(identity.community).toBeUndefined();
});

test('tolerates an unreachable station', async () => {
  mockWhoami.mockRejectedValue(new Error('offline'));
  let identity: any;
  await renderProbe(d => (identity = d));
  expect(identity.address).toBe('rrn1qmemember');
  expect(identity.community).toBeUndefined();
});
