/**
 * The Railroad Network brand symbol — a North Star network mark: eight spokes
 * radiating from a central four-point star out to nodes ("eight paths converge
 * on a central four-point star").
 *
 * Reproduced 1:1 from the design system's mark (`ui_kits/mobile` StarMark /
 * `assets/brand/railroad-network-symbol.svg`): 240×240 space, single color
 * applied to strokes and fills alike.
 */
import Svg, {Circle, G, Line, Polygon} from 'react-native-svg';

export interface StarMarkProps {
  size?: number;
  color?: string;
}

// Eight spokes: 4 cardinal + 4 diagonal, each from the outer node in to the
// central star. [x1, y1, x2, y2].
const SPOKES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, -100, 0, -32],
  [0, 100, 0, 32],
  [-100, 0, -32, 0],
  [100, 0, 32, 0],
  [-70.7, -70.7, -22.6, -22.6],
  [70.7, -70.7, 22.6, -22.6],
  [-70.7, 70.7, -22.6, 22.6],
  [70.7, 70.7, 22.6, 22.6],
];

// Outer nodes: cardinal (r=8) and diagonal (r=6). [cx, cy, r].
const NODES: ReadonlyArray<readonly [number, number, number]> = [
  [0, -100, 8],
  [0, 100, 8],
  [-100, 0, 8],
  [100, 0, 8],
  [-70.7, -70.7, 6],
  [70.7, -70.7, 6],
  [-70.7, 70.7, 6],
  [70.7, 70.7, 6],
];

export function StarMark({size = 32, color = '#E0A24A'}: StarMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 240 240" accessibilityRole="image">
      <G transform="translate(120, 120)">
        <G stroke={color} strokeWidth={6} fill="none" strokeLinecap="round">
          {SPOKES.map(([x1, y1, x2, y2], i) => (
            <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </G>
        <G fill={color}>
          <Polygon points="0,-32 9,0 0,32 -9,0" />
          <Polygon points="-32,0 0,-9 32,0 0,9" />
          {NODES.map(([cx, cy, r], i) => (
            <Circle key={i} cx={cx} cy={cy} r={r} />
          ))}
        </G>
      </G>
    </Svg>
  );
}
