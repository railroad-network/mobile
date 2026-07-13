/**
 * Amount — a ledger value in Commons. Green is credit, red is debit, exactly as
 * a ledger reads. Always monospace tabular figures, always two decimals, and the
 * {@link CommonMark} glyph. The single most-used number on the platform.
 *
 * Takes **signed integer centi** (see `ledger/format`), never a float: positive
 * is a credit (`+`), negative a debit (a proper minus), zero is muted.
 */
import {StyleSheet, View} from 'react-native';

import {useTheme} from '../theme';
import {amountSign, formatCommons} from '../ledger/format';
import {CommonMark} from './CommonMark';
import {Text} from './Text';

export type AmountSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AmountProps {
  /** The value in signed integer centi (hundredths of a Common). */
  centi: number;
  size?: AmountSize;
  /** Show the leading `+` / `−` sign. Defaults to `true`. */
  signed?: boolean;
  /** Color credit green / debit red. Defaults to `true`. */
  colored?: boolean;
  /** Force a specific color (e.g. on the dark balance hero). Overrides `colored`. */
  color?: string;
  /** Show the trailing Common mark. Defaults to `true`. */
  showMark?: boolean;
}

/** Digit font size per size token. */
const FONT_SIZE: Record<AmountSize, number> = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 30,
  xl: 44,
};

export function Amount({
  centi,
  size = 'md',
  signed = true,
  colored = true,
  color,
  showMark = true,
}: AmountProps) {
  const theme = useTheme();

  const resolved =
    color ??
    (colored
      ? centi > 0
        ? theme.colors.credit
        : centi < 0
          ? theme.colors.debit
          : theme.colors.textMuted
      : theme.colors.text);

  const fontSize = FONT_SIZE[size];
  const sign = signed ? amountSign(centi) : '';

  return (
    <View style={styles.row} accessibilityLabel={`${accessibleSign(centi)}${formatCommons(centi)} Commons`}>
      <Text
        variant="mono"
        color={resolved}
        style={{
          fontSize,
          lineHeight: fontSize * 1.05,
          fontWeight: '600',
          letterSpacing: size === 'xl' ? -0.5 : 0,
        }}
        allowFontScaling={false}>
        {sign}
        {formatCommons(centi)}
      </Text>
      {showMark && (
        <View style={styles.mark}>
          <CommonMark size={Math.round(fontSize * 0.72)} color={resolved} />
        </View>
      )}
    </View>
  );
}

function accessibleSign(centi: number): string {
  if (centi > 0) return 'plus ';
  if (centi < 0) return 'minus ';
  return '';
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center'},
  mark: {marginLeft: 4},
});
