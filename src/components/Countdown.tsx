/**
 * Countdown — a live count down to an absolute time, ticking each second. Used
 * for a proposal's "expires in" and a confirmed payment's "settles in" (the
 * settlement/dispute window). Under a day it reads `HH:MM:SS`, ticking every
 * second; a day or more out it drops to a coarse `3d 1h` form, because a raw
 * `HH:MM:SS` clock at that scale (e.g. `335:59:18` for a two-week window) stops
 * being legible. Once the target passes it shows {@link expiredLabel}.
 */
import {useEffect, useState} from 'react';
import type {StyleProp, TextStyle} from 'react-native';

import {Text} from './Text';

export interface CountdownProps {
  /** Target time in unix seconds. */
  until: number;
  /** Text colour. */
  color?: string;
  style?: StyleProp<TextStyle>;
  /** Shown once the target time has passed. Defaults to `"00:00:00"`. */
  expiredLabel?: string;
}

/**
 * Formats a positive remaining duration. Under a day: `HH:MM:SS` (hours are not
 * capped, but stay two-digit at this scale). A day or more: `3d 1h` — or `3d`
 * on the hour — trading second precision no one is watching for legibility.
 */
export function formatDuration(secs: number): string {
  const DAY = 24 * 3600;
  if (secs >= DAY) {
    const days = Math.floor(secs / DAY);
    const hours = Math.floor((secs % DAY) / 3600);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
}

export function Countdown({until, color, style, expiredLabel = '00:00:00'}: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.floor(until - now / 1000);
  return (
    <Text variant="mono" color={color} style={style} allowFontScaling={false}>
      {remaining <= 0 ? expiredLabel : formatDuration(remaining)}
    </Text>
  );
}
