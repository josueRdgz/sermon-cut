import { describe, expect, it } from 'vitest';

import { quantizeFramingPreviewTime } from './framingPreview';

describe('quantizeFramingPreviewTime', () => {
  it('snaps to 0.25 s buckets', () => {
    expect(quantizeFramingPreviewTime(10.12)).toBe(10);
    expect(quantizeFramingPreviewTime(10.13)).toBe(10.25);
    expect(quantizeFramingPreviewTime(10.4)).toBe(10.5);
  });

  it('clamps invalid times', () => {
    expect(quantizeFramingPreviewTime(Number.NaN)).toBe(0);
    expect(quantizeFramingPreviewTime(-3)).toBe(0);
  });
});
