import { describe, expect, it } from 'vitest';

import {
  clampTransitionMs,
  formatTransitionSeconds,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  sourceGapSeconds,
  TRANSITION_OPTIONS,
  TRAY_TRANSITION_OPTIONS,
} from './clipConstants';

describe('clipConstants', () => {
  it('reports a positive source gap between non-contiguous cuts', () => {
    expect(sourceGapSeconds(12.4, 29.1)).toBeCloseTo(16.7);
  });

  it('reports a negative overlap when the next cut starts earlier', () => {
    expect(sourceGapSeconds(10, 8.5)).toBeCloseTo(-1.5);
  });

  it('offers between 14 and 20 named transitions', () => {
    expect(TRANSITION_OPTIONS.length).toBeGreaterThanOrEqual(14);
    expect(TRANSITION_OPTIONS.length).toBeLessThanOrEqual(20);
    expect(TRAY_TRANSITION_OPTIONS.every((option) => option.value !== 'hard_cut')).toBe(true);
  });

  it('clamps transition duration into a usable window', () => {
    expect(clampTransitionMs(Number.NaN)).toBe(350);
    expect(clampTransitionMs(10)).toBe(MIN_TRANSITION_MS);
    expect(clampTransitionMs(9000)).toBe(MAX_TRANSITION_MS);
    expect(formatTransitionSeconds(350)).toBe('0,35 s');
  });
});
