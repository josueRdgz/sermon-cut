import { describe, expect, it } from 'vitest';

import {
  envelopeDotStyle,
  envelopePolyline,
  interpolateGain,
  normalizeKeyframes,
  removeKeyframe,
  scaleEnvelopeToGain,
  seedEndpoints,
  shiftEnvelopeGain,
  upsertKeyframe,
} from './volumeEnvelope';

describe('volumeEnvelope', () => {
  it('removes a nearby keyframe and keeps the rest', () => {
    const next = removeKeyframe(
      [
        { t_ms: 0, gain: 1 },
        { t_ms: 400, gain: 0.4 },
        { t_ms: 900, gain: 1 },
      ],
      410,
    );
    expect(next).toEqual([
      { t_ms: 0, gain: 1 },
      { t_ms: 900, gain: 1 },
    ]);
  });

  it('keeps a flat full-gain point when the last keyframe is deleted', () => {
    expect(removeKeyframe([{ t_ms: 120, gain: 0.2 }], 120)).toEqual([{ t_ms: 0, gain: 1 }]);
    expect(normalizeKeyframes([])).toEqual([{ t_ms: 0, gain: 1 }]);
  });

  it('adds start and end handles on a flat envelope', () => {
    expect(seedEndpoints([{ t_ms: 0, gain: 0.8 }], 2000)).toEqual([
      { t_ms: 0, gain: 0.8 },
      { t_ms: 2000, gain: 0.8 },
    ]);
  });

  it('keeps leftover keyframes inside the clip duration', () => {
    expect(seedEndpoints([{ t_ms: 0, gain: 1 }, { t_ms: 9000, gain: 0.2 }], 2000)).toEqual([
      { t_ms: 0, gain: 1 },
      { t_ms: 2000, gain: 0.2 },
    ]);
  });

  it('raises or lowers the whole envelope without changing its shape', () => {
    const next = shiftEnvelopeGain(
      [
        { t_ms: 0, gain: 1 },
        { t_ms: 800, gain: 0.4 },
      ],
      -0.25,
    );
    expect(next[0].gain).toBeCloseTo(0.75);
    expect(next[1].gain).toBeCloseTo(0.15);
  });

  it('scales the envelope so the playhead gain matches the slider', () => {
    const next = scaleEnvelopeToGain(
      [
        { t_ms: 0, gain: 1 },
        { t_ms: 1000, gain: 0.5 },
      ],
      0,
      0.4,
    );
    expect(next[0].gain).toBeCloseTo(0.4);
    expect(next[1].gain).toBeCloseTo(0.2);
  });

  it('inserts an inflection point on the current curve', () => {
    const next = upsertKeyframe(
      [
        { t_ms: 0, gain: 1 },
        { t_ms: 1000, gain: 0 },
      ],
      500,
      interpolateGain(
        [
          { t_ms: 0, gain: 1 },
          { t_ms: 1000, gain: 0 },
        ],
        500,
      ),
    );
    expect(next).toHaveLength(3);
    expect(next[1].t_ms).toBe(500);
    expect(next[1].gain).toBeCloseTo(0.5);
  });

  it('keeps envelope handles inside the waveform strip', () => {
    const start = envelopeDotStyle(0, 2000, 1);
    const end = envelopeDotStyle(2000, 2000, 0);
    expect(start.left).toContain('0.000%');
    expect(end.left).toContain('100.000%');
    expect(Number.parseFloat(start.top)).toBeGreaterThan(0);
    expect(Number.parseFloat(end.top)).toBeLessThan(100);
  });

  it('starts the audio curve at the beginning of the clip', () => {
    const points = envelopePolyline(
      [
        { t_ms: 0, gain: 1 },
        { t_ms: 1000, gain: 1 },
      ],
      1000,
      2,
    );
    expect(points.startsWith('0.00,')).toBe(true);
    expect(points).toContain('100.00,');
  });
});
