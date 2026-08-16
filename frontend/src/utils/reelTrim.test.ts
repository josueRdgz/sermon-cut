import { describe, expect, it } from 'vitest';

import type { ReelSegment } from '../types/reel';
import { clampRippleTrim } from './reelTrim';

function seg(
  id: string,
  order: number,
  start: number,
  end: number,
): ReelSegment {
  return {
    id,
    reel_id: 'r1',
    order,
    source_start_seconds: start,
    source_end_seconds: end,
    duration_seconds: end - start,
    transition_type: 'hard_cut',
    transition_duration_ms: 0,
    transcript_text: null,
  };
}

describe('clampRippleTrim', () => {
  const clips = [
    seg('a', 0, 10, 14),
    seg('b', 1, 20, 26),
    seg('c', 2, 30, 34),
  ];

  it('lets a clip eat the source gap but not overlap the next', () => {
    const next = clampRippleTrim(clips, 'b', { source_end_seconds: 40 });
    expect(next?.source_end_seconds).toBeCloseTo(30);
    expect(next?.source_start_seconds).toBeCloseTo(20);
  });

  it('lets a clip eat the previous gap but not overlap the previous clip', () => {
    const next = clampRippleTrim(clips, 'b', { source_start_seconds: 12 });
    expect(next?.source_start_seconds).toBeCloseTo(14);
  });

  it('rejects a window shorter than the minimum', () => {
    expect(clampRippleTrim(clips, 'a', { source_end_seconds: 10.05 })).toBeNull();
  });
});
