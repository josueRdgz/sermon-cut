import { describe, expect, it } from 'vitest';

import type { ReelSegment } from '../types/reel';
import { previewTimelineIdentity, playheadAfterTrim, resolvePreviewSeek } from './reelPreview';

function segment(
  id: string,
  order: number,
  sourceStart: number,
  sourceEnd: number,
  transition: ReelSegment['transition_type'] = 'hard_cut',
  transitionMs = 0,
): ReelSegment {
  return {
    id,
    reel_id: 'reel-1',
    order,
    source_start_seconds: sourceStart,
    source_end_seconds: sourceEnd,
    transcript_text: null,
    transition_type: transition,
    transition_duration_ms: transitionMs,
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

  it('respects crossfade overlap on the output clock', () => {
    const xfade = [
      segment('a', 0, 0, 5, 'short_crossfade', 500),
      segment('b', 1, 10, 16, 'hard_cut', 0),
    ];
    // Total = 5 + 6 - 0.5 = 10.5; B starts at 4.5
    expect(resolvePreviewSeek(xfade, 4.4)).toEqual({
      outputTime: 4.4,
      segmentIndex: 0,
      sourceTime: 4.4,
    });
    expect(resolvePreviewSeek(xfade, 4.5)).toEqual({
      outputTime: 4.5,
      segmentIndex: 1,
      sourceTime: 10,
    });
    expect(resolvePreviewSeek(xfade, 5)?.segmentIndex).toBe(1);
    expect(resolvePreviewSeek(xfade, 5)?.sourceTime).toBeCloseTo(10.5, 5);
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

  it('changes when the selected Reel or timing changes', () => {
    const original = [segment('a', 0, 10, 15), segment('b', 1, 40, 47)];
    const trimmed = [
      segment('a', 0, 10, 15),
      segment('b', 1, 40, 47, 'fade', 400),
    ];

    expect(previewTimelineIdentity('reel-2', original)).not.toBe(
      previewTimelineIdentity('reel-1', original),
    );
    expect(previewTimelineIdentity('reel-1', trimmed)).not.toBe(
      previewTimelineIdentity('reel-1', original),
    );
  });
});

describe('playheadAfterTrim', () => {
  const segments = [segment('a', 0, 10, 20), segment('b', 1, 40, 50)];

  it('keeps the playhead when the cut still contains the current time', () => {
    expect(playheadAfterTrim(segments, 0, 15)).toEqual({
      segmentIndex: 0,
      sourceTime: 15,
      outputTime: 5,
      seekRequired: false,
    });
  });

  it('does not jump to the first fragment when a later clip is trimmed', () => {
    const trimmed = [segment('a', 0, 10, 20), segment('b', 1, 42, 50)];
    expect(playheadAfterTrim(trimmed, 1, 45)).toMatchObject({
      segmentIndex: 1,
      sourceTime: 45,
      seekRequired: false,
    });
  });

  it('clamps into the new in-point when the start passes the playhead', () => {
    const trimmed = [segment('a', 0, 16, 20), segment('b', 1, 40, 50)];
    expect(playheadAfterTrim(trimmed, 0, 15)).toMatchObject({
      segmentIndex: 0,
      sourceTime: 16,
      seekRequired: true,
    });
  });

  it('advances to the next clip when the out-point passes the playhead', () => {
    const trimmed = [segment('a', 0, 10, 14), segment('b', 1, 40, 50)];
    expect(playheadAfterTrim(trimmed, 0, 15)).toMatchObject({
      segmentIndex: 1,
      sourceTime: 40,
      seekRequired: true,
    });
  });
});
