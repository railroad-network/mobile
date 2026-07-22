/**
 * @format
 *
 * Community tab (T1.4.1): shows the member's community when paired, prompts to
 * pair when not, and opens the Vouch flow.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ThemeProvider} from '../src/theme';
import {Community} from '../src/screens/main/Community';

const mockIdentity: {data?: {address: string; community?: string}} = {};
jest.mock('../src/ledger', () => ({
  ...jest.requireActual('../src/ledger'),
  useIdentity: () => mockIdentity,
}));

const metrics = {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function renderCommunity(navigation: any): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <Community navigation={navigation} route={{} as any} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}

const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text)).length > 0;

beforeEach(() => {
  mockIdentity.data = {address: 'rrn1qme', community: 'rrn-phase0'};
});

test('shows the community when paired', async () => {
  const r = await renderCommunity({navigate: jest.fn()});
  expect(hasText(r, 'member of rrn-phase0')).toBe(true);
});

test('prompts to pair when there is no community yet', async () => {
  mockIdentity.data = {address: 'rrn1qme'};
  const r = await renderCommunity({navigate: jest.fn()});
  expect(hasText(r, 'Pair with a station')).toBe(true);
});

test('the vouch row opens the Vouch flow', async () => {
  const navigation = {navigate: jest.fn()};
  const r = await renderCommunity(navigation);
  const row = r.root.find(n => n.props.accessibilityLabel === 'Vouch for someone');
  await act(async () => {
    row.props.onPress();
  });
  expect(navigation.navigate).toHaveBeenCalledWith('Vouch');
});
