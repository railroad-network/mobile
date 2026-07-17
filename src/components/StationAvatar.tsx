/**
 * StationAvatar — the chip that marks a station in a list: the station-side
 * counterpart to {@link Identicon}. A station is a network node, not a person,
 * so it carries the Railroad Network's North Star {@link StarMark} rather than
 * an identity's block pattern — the same rounded-tile footprint as Identicon,
 * so station rows line up with the identity rows elsewhere in the app.
 *
 * Like Identicon, the tile keeps its own constant backdrop — the brand's amber
 * mark on a dark "night" tile — so it stays legible on both the light and dark
 * themes without depending on the running theme.
 */
import {StyleSheet, View} from 'react-native';

import {StarMark} from './StarMark';

export interface StationAvatarProps {
  /** Edge length in points. */
  size?: number;
  radius?: number;
}

/** Brand "night": a constant dark tile (dark-theme surface) with the North */
/** Star in amber (dark-theme accent), legible under either theme. */
const TILE_BG = '#211C16';
const MARK = '#E0A24A';

export function StationAvatar({size = 44, radius = 12}: StationAvatarProps) {
  return (
    <View
      style={[styles.tile, {width: size, height: size, borderRadius: radius, backgroundColor: TILE_BG}]}
      accessibilityRole="image"
      accessibilityLabel="Station">
      <StarMark size={Math.round(size * 0.64)} color={MARK} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {overflow: 'hidden', alignItems: 'center', justifyContent: 'center'},
});
