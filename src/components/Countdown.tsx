/**
 * Countdown — a live `HH:MM:SS` count down to an absolute time, ticking each
 * second. Used for a proposal's "expires in" and a confirmed payment's "settles
 * in" (the settlement/dispute window). Hours are not capped at 24, so a 48-hour
 * window reads `47:59:59`. Once the target passes it shows {@link expiredLabel}.
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

function formatDuration(secs: number): string {
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
