/**
 * @format
 *
 * The Amount primitive (T1.2.4) — the most-used number on the platform. It shows
 * signed centi as grouped two-decimal Commons with a screen-reader-friendly
 * label, and can drop the sign/mark for contexts like the balance hero.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

import {ThemeProvider} from '../src/theme';
import {Amount} from '../src/components';

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function render(ui: React.ReactElement): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<ThemeProvider>{ui}</ThemeProvider>);
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}

const digitsOf = (r: Renderer): string =>
  textOf(r.root.findAll(n => (n.type as unknown as string) === 'Text')[0]);

const labelOf = (r: Renderer): string | undefined =>
  r.root.find(n => typeof n.props.accessibilityLabel === 'string').props.accessibilityLabel;

test('renders a credit with a plus sign and an accessible label', async () => {
  const r = await render(<Amount centi={800} />);
  expect(digitsOf(r)).toBe('+8.00');
  expect(labelOf(r)).toBe('plus 8.00 Commons');
});

test('renders a debit with a proper minus', async () => {
  const r = await render(<Amount centi={-1250} />);
  expect(digitsOf(r)).toBe('−12.50');
  expect(labelOf(r)).toBe('minus 12.50 Commons');
});

test('renders zero without a sign', async () => {
  const r = await render(<Amount centi={0} />);
  expect(digitsOf(r)).toBe('0.00');
  expect(labelOf(r)).toBe('0.00 Commons');
});

test('can drop the sign (balance hero)', async () => {
  const r = await render(<Amount centi={2400} signed={false} />);
  expect(digitsOf(r)).toBe('24.00');
});
