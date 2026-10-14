/**
 * The recovery-ceremony fingerprint in large type (ADR-0016).
 *
 * The code comes from the core exactly as it renders it — hyphen-joined groups —
 * and is shown as given: nothing here computes, re-encodes, or normalizes it.
 * Each group is its own text run in a wrapping row, so on a narrow screen the
 * code wraps only between groups and is never cut by an ellipsis or broken
 * inside a group. A screen reader hears it group by group.
 */
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {Text} from './Text';
import {useTheme} from '../theme';

export interface CeremonyFingerprintProps {
  /** The fingerprint exactly as the core returned it. */
  code: string;
  /** Type size; the default suits a holder's confirm card. */
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function CeremonyFingerprint({code, fontSize = 24, style}: CeremonyFingerprintProps) {
  const theme = useTheme();
  const groups = code.split('-');
  return (
    <View
      accessible
      accessibilityLabel={`Ceremony fingerprint: ${groups.join(', ')}`}
      testID="ceremony-fingerprint"
      style={[styles.row, style]}>
      {groups.map((group, i) => (
        <Text
          key={i}
          variant="mono"
          color={theme.colors.text}
          style={[styles.group, {fontSize}]}>
          {i < groups.length - 1 ? `${group}-` : group}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center'},
  group: {letterSpacing: 2},
});
