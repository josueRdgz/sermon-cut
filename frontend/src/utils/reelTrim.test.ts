import { describe, expect, it } from 'vitest';

import type { ReelSegment } from '../types/reel';
import { canJoinSourceWindows, clampRippleTrim, splitTooCloseToEdge } from './reelTrim';

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

describe('canJoinSourceWindows', () => {
  it('allows joining a user split that still shares the source cut', () => {
    expect(canJoinSourceWindows(14, 14)).toBe(true);
    expect(canJoinSourceWindows(14, 14.04)).toBe(true);
  });

  it('rejects analysis cuts separated by omitted source', () => {
    expect(canJoinSourceWindows(9.07, 14)).toBe(false);
  });
});

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

describe('splitTooCloseToEdge', () => {
  it('rejects cuts inside the 0.2s margin', () => {
    expect(splitTooCloseToEdge(10, 10.1, 20)).toBe(true);
    expect(splitTooCloseToEdge(10, 19.9, 20)).toBe(true);
    expect(splitTooCloseToEdge(10, 15, 20)).toBe(false);
  });
});
