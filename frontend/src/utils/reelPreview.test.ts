import { describe, expect, it } from 'vitest';

import type { ReelSegment } from '../types/reel';
import { previewTimelineIdentity, resolvePreviewSeek } from './reelPreview';

function segment(id: string, order: number, sourceStart: number, sourceEnd: number): ReelSegment {
  return {
    id,
    reel_id: 'reel-1',
    order,
    source_start_seconds: sourceStart,
    source_end_seconds: sourceEnd,
    transcript_text: null,
    transition_type: 'hard_cut',
    transition_duration_ms: 0,
    duration_seconds: sourceEnd - sourceStart,
  };
}

describe('resolvePreviewSeek', () => {
  const segments = [segment('a', 0, 10, 15), segment('b', 1, 40, 47)];

  it('maps output time to the source clock across non-consecutive fragments', () => {
    expect(resolvePreviewSeek(segments, 2.5)).toEqual({
      outputTime: 2.5,
      segmentIndex: 0,
      sourceTime: 12.5,
    });
    expect(resolvePreviewSeek(segments, 8)).toEqual({
      outputTime: 8,
      segmentIndex: 1,
      sourceTime: 43,
    });
  });

  it('maps an exact cut boundary to the following fragment', () => {
    expect(resolvePreviewSeek(segments, 5)).toEqual({
      outputTime: 5,
      segmentIndex: 1,
      sourceTime: 40,
    });
  });

  it('clamps invalid and out-of-range positions', () => {
    expect(resolvePreviewSeek(segments, Number.NaN)?.outputTime).toBe(0);
    expect(resolvePreviewSeek(segments, -8)?.sourceTime).toBe(10);
    expect(resolvePreviewSeek(segments, 99)).toEqual({
      outputTime: 12,
      segmentIndex: 1,
      sourceTime: 47,
    });
    expect(resolvePreviewSeek([], 1)).toBeNull();
  });
});

describe('previewTimelineIdentity', () => {
  it('does not change for metadata-only Reel updates', () => {
    const original = [segment('a', 0, 10, 15), segment('b', 1, 40, 47)];
    const responseAfterAudioSave = original.map((item) => ({ ...item }));

    expect(previewTimelineIdentity('reel-1', responseAfterAudioSave)).toBe(
      previewTimelineIdentity('reel-1', original),
    );
  });

  it('changes when the selected Reel or first fragment changes', () => {
    const original = [segment('a', 0, 10, 15), segment('b', 1, 40, 47)];
    const reordered = [original[1], original[0]];

    expect(previewTimelineIdentity('reel-2', original)).not.toBe(
      previewTimelineIdentity('reel-1', original),
    );
    expect(previewTimelineIdentity('reel-1', reordered)).not.toBe(
      previewTimelineIdentity('reel-1', original),
    );
  });
});
