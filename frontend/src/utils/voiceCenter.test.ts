import { describe, expect, it } from 'vitest';

import { clampVoiceCenter, getVoiceCenterGraph, voiceCenterGains } from './voiceCenter';

describe('voiceCenterGains', () => {
  it('is a passthrough at 0', () => {
    expect(voiceCenterGains(0)).toEqual({ keepLeft: 1, mixRightIntoLeft: 0 });
  });

  it('copies some of the right channel into the left at 0.35', () => {
    const { keepLeft, mixRightIntoLeft } = voiceCenterGains(0.35);
    expect(keepLeft).toBeCloseTo(1 / 1.35, 5);
    expect(mixRightIntoLeft).toBeCloseTo(0.35 / 1.35, 5);
    expect(keepLeft + mixRightIntoLeft).toBeCloseTo(1, 5);
  });

  it('clamps out of range values', () => {
    expect(clampVoiceCenter(2)).toBe(1);
    expect(clampVoiceCenter(-1)).toBe(0);
  });
});

describe('getVoiceCenterGraph', () => {
  it('reuses one graph so remounts do not recapture media elements', () => {
    expect(getVoiceCenterGraph()).toBe(getVoiceCenterGraph());
  });
});
