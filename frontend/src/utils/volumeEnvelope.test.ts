import { describe, expect, it } from 'vitest';

import { normalizeKeyframes, removeKeyframe, scaleEnvelopeToGain, seedEndpoints } from './volumeEnvelope';

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
});
