/**
 * @format
 *
 * Badge is a single-line status pill. A multi-word label ("Awaiting quorum")
 * used to wrap on a sub-pixel measurement rounding, dropping the second word and
 * leaving phantom right padding; `numberOfLines={1}` pins it to one line. This
 * guards that so the regression can't return.
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

import {ThemeProvider} from '../src/theme';
import {Badge} from '../src/components';

test('a badge label is constrained to a single line', async () => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <ThemeProvider>
        <Badge variant="neutral" size="sm">
          Awaiting quorum
        </Badge>
      </ThemeProvider>,
    );
  });
  const texts = r.root.findAll(n => (n.type as unknown as string) === 'Text');
  const labels = texts.filter(n => n.props.numberOfLines === 1);
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.some(n => textOf(n).includes('Awaiting quorum'))).toBe(true);
  act(() => r.unmount());
});

function textOf(node: ReactTestRenderer.ReactTestInstance): string {
  return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('');
}
