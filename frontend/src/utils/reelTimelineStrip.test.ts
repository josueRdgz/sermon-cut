import { describe, expect, it } from 'vitest';

import type { ReelSegment } from '../types/reel';
import {
  buildClipSpans,
  buildSourceGaps,
  outputTimeFromTrackRatio,
  playheadPercent,
} from './reelTimelineStrip';

function seg(id: string, duration: number, order: number): ReelSegment {
  return {
    id,
    reel_id: 'r1',
    order,
    source_start_seconds: 0,
    source_end_seconds: duration,
    duration_seconds: duration,
    transition_type: 'hard_cut',
    transition_duration_ms: 0,
    transcript_text: null,
  };
}

describe('reelTimelineStrip', () => {
  it('builds proportional spans on the output clock', () => {
    const spans = buildClipSpans([seg('a', 2, 0), seg('b', 6, 1), seg('c', 2, 2)]);
    expect(spans).toHaveLength(3);
    expect(spans[0].leftRatio).toBeCloseTo(0);
    expect(spans[0].widthRatio).toBeCloseTo(0.2);
    expect(spans[1].leftRatio).toBeCloseTo(0.2);
    expect(spans[1].widthRatio).toBeCloseTo(0.6);
    expect(spans[2].leftRatio).toBeCloseTo(0.8);
    expect(spans[2].widthRatio).toBeCloseTo(0.2);
  });

  it('maps track click ratio to output time', () => {
    expect(outputTimeFromTrackRatio(0.25, 40)).toBeCloseTo(10);
    expect(outputTimeFromTrackRatio(-1, 40)).toBe(0);
    expect(outputTimeFromTrackRatio(2, 40)).toBe(40);
  });

  it('marks source-sermon holes between concatenated clips', () => {
    const gaps = buildSourceGaps([
      {
        ...seg('a', 2, 0),
        source_start_seconds: 10,
        source_end_seconds: 12,
      },
      {
        ...seg('b', 6, 1),
        source_start_seconds: 30,
        source_end_seconds: 36,
      },
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].sourceSeconds).toBeCloseTo(18);
    expect(gaps[0].afterIndex).toBe(1);
  });

  it('computes playhead percent', () => {
    expect(playheadPercent(5, 20)).toBeCloseTo(25);
    expect(playheadPercent(100, 20)).toBe(100);
  });

  it('overlaps clip spans when a crossfade shortens the output clock', () => {
    const spans = buildClipSpans([
      {
        ...seg('a', 5, 0),
        source_start_seconds: 0,
        source_end_seconds: 5,
        transition_type: 'short_crossfade',
        transition_duration_ms: 500,
      },
      {
        ...seg('b', 6, 1),
        source_start_seconds: 10,
        source_end_seconds: 16,
      },
    ]);
    expect(spans[1].leftRatio).toBeLessThan(spans[0].leftRatio + spans[0].widthRatio);
  });
});
