/**
 * Identicon — a deterministic avatar derived from an address (or any seed). A
 * symmetric 5×5 block pattern with a color picked from the seed, so the same
 * identity always renders the same mark. Ported from the design system's
 * MobileKit identicon (FNV-1a hash, mirrored 3→5 columns).
 *
 * The tile keeps a constant light background so the mark stays legible on both
 * the light and dark themes, the way an avatar chip carries its own backdrop.
 */
/* eslint-disable no-bitwise -- a hash function is inherently bit manipulation */
import {StyleSheet, View} from 'react-native';
import Svg, {Rect} from 'react-native-svg';

/** Saturated ledger-palette colors; index chosen from the seed hash. */
const PALETTE = ['#1E5038', '#2F586E', '#A65A18', '#9C331C', '#2A6A4A', '#834312', '#213E4E'];
/** Paper-2: a constant light tile, legible under either theme. */
const TILE_BG = '#EAE1D2';

/** FNV-1a, matching the design system's `mkHash` exactly. */
function fnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface IdenticonProps {
  /** The value the pattern is derived from — typically an `rrn1…` address. */
  seed: string;
  /** Edge length in points. */
  size?: number;
  radius?: number;
}

export function Identicon({seed, size = 44, radius = 12}: IdenticonProps) {
  const h = fnv1a(seed);
  const color = PALETTE[h % PALETTE.length];
  const u = size / 5;

  const cells: Array<[number, number]> = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      const on = ((h >>> (r * 3 + c)) & 1) === 1;
      if (on) {
        cells.push([c, r]);
        if (c < 2) cells.push([4 - c, r]);
      }
    }
  }

  return (
    <View
      style={[styles.tile, {width: size, height: size, borderRadius: radius, backgroundColor: TILE_BG}]}
      accessibilityRole="image"
      accessibilityLabel={`Identity avatar for ${seed}`}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {cells.map(([c, r], i) => (
          <Rect key={i} x={c * u} y={r * u} width={u + 0.5} height={u + 0.5} fill={color} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {overflow: 'hidden'},
});
