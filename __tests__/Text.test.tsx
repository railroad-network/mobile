/**
 * @format
 *
 * The `Text` primitive's line-box handling. A `style` that raises `fontSize`
 * past the variant's `lineHeight` used to keep that line box and crop the
 * glyphs — the confirm-receipt settlement clock (`mono` at 36px in `mono`'s
 * 20px box) rendered visibly sliced. `Text` now scales the line box for such a
 * style, while leaving styles that still fit, and explicit `lineHeight`s, alone.
 *
 * Uses `react-test-renderer` directly (as the other component tests do).
 */
import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {StyleSheet, Text as RNText, type TextStyle} from 'react-native';

import {ThemeProvider} from '../src/theme';
import {Text} from '../src/components/Text';
import {typeScale} from '../src/theme/typography';

/** Render `Text` and return the flattened style RN would apply. */
function styleOf(element: React.ReactElement): TextStyle {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  const rendered = tree.root.findByType(RNText);
  return StyleSheet.flatten(rendered.props.style) as TextStyle;
}

describe('Text line box', () => {
  it('scales the line box for a fontSize that outgrew the variant', () => {
    const style = styleOf(<Text variant="mono" style={{fontSize: 36}} />);

    expect(style.fontSize).toBe(36);
    // mono is 14/20, so 36px keeps that 1.43 proportion rather than the 20 that
    // cropped it.
    expect(style.lineHeight).toBe(51);
    expect(style.lineHeight).toBeGreaterThan(style.fontSize!);
  });

  it('leaves a fontSize that still fits its variant untouched', () => {
    // The inbox/settings nicknames: mono at 16px still fits mono's 20px box, so
    // the line box must not shift under them.
    const style = styleOf(<Text variant="mono" style={{fontSize: 16}} />);

    expect(style.fontSize).toBe(16);
    expect(style.lineHeight).toBe(typeScale.mono.lineHeight);
  });

  it('honours an explicit lineHeight over the scaled one', () => {
    const style = styleOf(<Text variant="mono" style={{fontSize: 36, lineHeight: 44}} />);

    expect(style.lineHeight).toBe(44);
  });

  it('reads fontSize through a nested style array', () => {
    const sheet = StyleSheet.create({clock: {fontSize: 36}});
    const style = styleOf(<Text variant="mono" style={[sheet.clock, {fontWeight: '700'}]} />);

    expect(style.lineHeight).toBe(51);
  });

  it('uses the variant line box when no style overrides fontSize', () => {
    const style = styleOf(<Text variant="body">body copy</Text>);

    expect(style.fontSize).toBe(typeScale.body.fontSize);
    expect(style.lineHeight).toBe(typeScale.body.lineHeight);
  });

  it('keeps every shipped fontSize override inside its line box', () => {
    // Guards the whole scale: no variant/size pairing may crop.
    for (const variant of Object.keys(typeScale) as (keyof typeof typeScale)[]) {
      for (const fontSize of [12, 16, 20, 22, 24, 30, 36, 44, 60]) {
        const style = styleOf(<Text variant={variant} style={{fontSize}} />);
        expect(style.lineHeight).toBeGreaterThanOrEqual(fontSize);
      }
    }
  });
});
