/**
 * @format
 *
 * ScreenHeader — the shared title block for pushed screens.
 *
 * The reason this component exists is that the markup was copy-pasted across
 * fifteen screens and VouchList shipped without a back link, so the tests worth
 * having are about the affordance being present and wired, not about layout.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

import {ThemeProvider} from '../src/theme';
import {BackLink, ScreenHeader} from '../src/components';

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Instance = ReactTestRenderer.ReactTestInstance;

async function render(node: React.ReactElement): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return r;
}

function textOf(node: Instance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}

const hasText = (r: Renderer, text: string): boolean =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes(text))
    .length > 0;

/** The back control, however many nodes carry its label. */
const backControl = (r: Renderer): Instance | undefined =>
  r.root.findAll(n => n.props.accessibilityLabel === 'Back')[0];

/**
 * How many back links are rendered. Counts the host `Text` carrying the
 * chevron, which is exactly one per {@link BackLink} — unlike the
 * accessibility label, which a `Pressable` puts on both the composite and its
 * host view, so a naive `findAll` on the label counts two per link and cannot
 * tell one back link from two.
 */
export const backCount = (r: Renderer): number =>
  r.root.findAll(n => (n.type as unknown as string) === 'Text' && textOf(n).includes('‹'))
    .length;

test('renders the title alone', async () => {
  const r = await render(<ScreenHeader title="Paired stations" />);
  expect(hasText(r, 'Paired stations')).toBe(true);
});

test('a header without onBack shows no back link', async () => {
  // Legitimate for a tab root — but it must be the absence of a prop, not the
  // absence of markup someone forgot to paste.
  const r = await render(<ScreenHeader title="Community" />);
  expect(backControl(r)).toBeUndefined();
  expect(backCount(r)).toBe(0);
});

test('onBack renders exactly one back link and fires it', async () => {
  const onBack = jest.fn();
  const r = await render(<ScreenHeader title="Your vouches" onBack={onBack} />);
  // Exactly one: a header that renders two is what shipped on VouchList when a
  // hand-written link survived alongside the component.
  expect(backCount(r)).toBe(1);
  await act(async () => {
    backControl(r)!.props.onPress();
  });
  expect(onBack).toHaveBeenCalled();
});

test('the subtitle is optional', async () => {
  const withOut = await render(<ScreenHeader title="Request payment" />);
  expect(hasText(withOut, 'Have someone scan this')).toBe(false);

  const withIt = await render(
    <ScreenHeader title="Request payment" subtitle="Have someone scan this to pay you." />,
  );
  expect(hasText(withIt, 'Have someone scan this to pay you.')).toBe(true);
});

test('the back label can be reworded', async () => {
  // ConfirmReceived words its exit for where it actually goes.
  const r = await render(<ScreenHeader title="Payment" onBack={jest.fn()} backLabel="Inbox" />);
  expect(hasText(r, '‹ ')).toBe(true);
  expect(hasText(r, 'Inbox')).toBe(true);
  expect(r.root.findAll(n => n.props.accessibilityLabel === 'Inbox').length).toBeGreaterThan(0);
});

test('BackLink stands alone for screens that place it themselves', async () => {
  const onPress = jest.fn();
  const r = await render(<BackLink onPress={onPress} />);
  await act(async () => {
    backControl(r)!.props.onPress();
  });
  expect(onPress).toHaveBeenCalled();
});

test('the back target is bigger than its text', async () => {
  // One short line of body text is a small thing to hit; the slop is why the
  // Pressable variant became the rule rather than the pressable Text.
  const r = await render(<ScreenHeader title="Discovery" onBack={jest.fn()} />);
  expect(backControl(r)!.props.hitSlop).toBe(12);
});
