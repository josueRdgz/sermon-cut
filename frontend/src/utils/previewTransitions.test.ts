import { describe, expect, it } from 'vitest';

import { previewXfadeStyle, xfadeAudioWeights } from './previewTransitions';

describe('previewTransitions', () => {
  it('crossfades opacity for fundido cruzado', () => {
    const mid = previewXfadeStyle('short_crossfade', 0.5);
    expect(mid.outOpacity).toBeCloseTo(0.5);
    expect(mid.inOpacity).toBeCloseTo(0.5);
    expect(mid.veilOpacity).toBe(0);
  });

  it('peaks a black veil in the middle of dip_to_black', () => {
    const start = previewXfadeStyle('dip_to_black', 0);
    const mid = previewXfadeStyle('dip_to_black', 0.5);
    const end = previewXfadeStyle('dip_to_black', 1);
    expect(start.outOpacity).toBeCloseTo(1);
    expect(start.inOpacity).toBeCloseTo(0);
    expect(mid.veilOpacity).toBeCloseTo(1);
    expect(mid.veilColor).toBe('#000');
    expect(end.outOpacity).toBeCloseTo(0);
    expect(end.inOpacity).toBeCloseTo(1);
  });

  it('wipes the incoming clip downward', () => {
    const start = previewXfadeStyle('wipe_down', 0);
    const end = previewXfadeStyle('wipe_down', 1);
    expect(start.inClipPath).toContain('100.000%');
    expect(end.inClipPath).toBe('inset(0 0 0.000% 0)');
  });

  it('mixes audio with a triangular acrossfade', () => {
    expect(xfadeAudioWeights(0)).toEqual({ out: 1, in: 0 });
    expect(xfadeAudioWeights(1)).toEqual({ out: 0, in: 1 });
    expect(xfadeAudioWeights(0.25).out).toBeCloseTo(0.75);
    expect(xfadeAudioWeights(0.25).in).toBeCloseTo(0.25);
  });
});
