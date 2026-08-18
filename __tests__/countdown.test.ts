import {formatDuration} from '../src/components/Countdown';

describe('formatDuration', () => {
  it('shows HH:MM:SS under a day, hours not capped at 24', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(59)).toBe('00:00:59');
    expect(formatDuration(3600 + 2 * 60 + 3)).toBe('01:02:03');
    // 23:59:59 is the last second before switching to the coarse form.
    expect(formatDuration(24 * 3600 - 1)).toBe('23:59:59');
  });

  it('drops to a coarse "Nd Mh" form a day or more out', () => {
    expect(formatDuration(24 * 3600)).toBe('1d');
    expect(formatDuration(24 * 3600 + 3600)).toBe('1d 1h');
    // ~3 days 1 hour — the two-week dispute window that used to read 335:59:18.
    expect(formatDuration(3 * 24 * 3600 + 3600 + 59 * 60)).toBe('3d 1h');
    expect(formatDuration(14 * 24 * 3600 - 3)).toBe('13d 23h');
    // On an exact day boundary the hours segment is dropped.
    expect(formatDuration(5 * 24 * 3600)).toBe('5d');
  });
});
