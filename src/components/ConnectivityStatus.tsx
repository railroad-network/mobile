/**
 * ConnectivityStatus — which transport tier the station is on right now. The
 * whole system degrades gracefully from internet → mesh → LoRa → paper → offline
 * (ADR-0006), and this is how a member sees where they stand. Never a scary
 * error; a calm statement of capability. A tinted pill with a signal-bar glyph
 * and an optional label.
 *
 * The live level comes from `ledger/useLedger`'s connectivity hook, mocked until
 * the mobile↔station transport lands (M1.3).
 */
import {StyleSheet, View} from 'react-native';

import {useTheme, type ColorTokens} from '../theme';
import {Text} from './Text';

export type ConnectivityLevel = 'internet' | 'mesh' | 'lora' | 'paper' | 'offline';

interface LevelConfig {
  label: string;
  /** Filled bars, 0–4. */
  bars: number;
}

const LEVELS: Record<ConnectivityLevel, LevelConfig> = {
  internet: {label: 'Internet', bars: 4},
  mesh: {label: 'Local mesh', bars: 3},
  lora: {label: 'LoRa radio', bars: 2},
  paper: {label: 'Paper relay', bars: 1},
  offline: {label: 'Offline', bars: 0},
};

/** Bar heights (points) for the four signal segments. */
const BAR_HEIGHTS = [6, 9, 12, 15];

function palette(level: ConnectivityLevel, c: ColorTokens): {bg: string; fg: string} {
  switch (level) {
    case 'internet':
      return {bg: c.successTint, fg: c.success};
    case 'mesh':
      return {bg: c.infoTint, fg: c.info};
    case 'lora':
      return {bg: c.warningTint, fg: c.warning};
    case 'paper':
      return {bg: c.surfaceSunken, fg: c.textSecondary};
    case 'offline':
    default:
      return {bg: c.dangerTint, fg: c.danger};
  }
}

export interface ConnectivityStatusProps {
  level?: ConnectivityLevel;
  showBars?: boolean;
  showLabel?: boolean;
}

export function ConnectivityStatus({
  level = 'internet',
  showBars = true,
  showLabel = true,
}: ConnectivityStatusProps) {
  const theme = useTheme();
  const cfg = LEVELS[level];
  const {bg, fg} = palette(level, theme.colors);

  return (
    <View
      style={[styles.pill, {backgroundColor: bg, borderRadius: theme.radius.full}]}
      accessibilityRole="text"
      accessibilityLabel={`Connectivity: ${cfg.label}`}>
      {showBars && (
        <View style={styles.bars}>
          {BAR_HEIGHTS.map((h, i) => (
            <View
              key={i}
              style={[styles.bar, {height: h, backgroundColor: fg, opacity: i < cfg.bars ? 1 : 0.3}]}
            />
          ))}
        </View>
      )}
      {showLabel && (
        <Text variant="label" color={fg} style={styles.label}>
          {cfg.label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  bars: {flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 15},
  bar: {width: 3, borderRadius: 1},
  label: {fontWeight: '700'},
});
