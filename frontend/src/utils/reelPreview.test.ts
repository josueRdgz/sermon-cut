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
      inPad: false,
    });
    expect(resolvePreviewSeek(segments, 8)).toEqual({
      outputTime: 8,
      segmentIndex: 1,
      sourceTime: 43,
      inPad: false,
    });
  });

  it('maps an exact cut boundary to the following fragment', () => {
    expect(resolvePreviewSeek(segments, 5)).toEqual({
      outputTime: 5,
      segmentIndex: 1,
      sourceTime: 40,
      inPad: false,
    });
  });

  it('clamps invalid and out-of-range positions', () => {
    expect(resolvePreviewSeek(segments, Number.NaN)?.outputTime).toBe(0);
    expect(resolvePreviewSeek(segments, -8)?.sourceTime).toBe(10);
    expect(resolvePreviewSeek(segments, 99)).toEqual({
      outputTime: 12,
      segmentIndex: 1,
      sourceTime: 47,
      inPad: false,
    });
    expect(resolvePreviewSeek([], 1)).toBeNull();
  });

  it('keeps both clips during the crossfade overlap', () => {
    const xfade = [
      segment('a', 0, 0, 5, 'short_crossfade', 500),
      segment('b', 1, 10, 16, 'hard_cut', 0),
    ];
    expect(resolvePreviewSeek(xfade, 4.4)).toEqual({
      outputTime: 4.4,
      segmentIndex: 0,
      sourceTime: 4.4,
      inPad: false,
    });
    expect(resolvePreviewSeek(xfade, 4.5)).toMatchObject({
      outputTime: 4.5,
      segmentIndex: 0,
      sourceTime: 4.5,
      inPad: false,
      xfade: {
        fromIndex: 0,
        toIndex: 1,
        progress: 0,
        duration: 0.5,
        incomingSourceTime: 10,
      },
    });
    expect(resolvePreviewSeek(xfade, 4.75)?.xfade?.progress).toBeCloseTo(0.5, 5);
    expect(resolvePreviewSeek(xfade, 5)?.segmentIndex).toBe(1);
    expect(resolvePreviewSeek(xfade, 5)?.sourceTime).toBeCloseTo(10.5, 5);
  });

  it('treats time before a clip as a black pad, not a source seek', () => {
    const padded = [
      { ...segment('a', 0, 10, 15), pad_before_ms: 2000 },
      { ...segment('b', 1, 40, 47), pad_before_ms: 500 },
    ];
    expect(resolvePreviewSeek(padded, 1)).toEqual({
      outputTime: 1,
      segmentIndex: 0,
      sourceTime: 10,
      inPad: true,
    });
    expect(resolvePreviewSeek(padded, 2)?.inPad).toBe(false);
    expect(resolvePreviewSeek(padded, 7.2)?.inPad).toBe(true);
    expect(resolvePreviewSeek(padded, 7.5)?.inPad).toBe(false);
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

  it('does not change when caption windows slide on the output clock', () => {
    const original = [segment('a', 0, 10, 15), segment('b', 1, 40, 47)];
    const moved = original.map((item, index) =>
      index === 0 ? { ...item, caption_in_ms: 400, caption_out_ms: 2800 } : item,
    );

    expect(previewTimelineIdentity('reel-1', moved)).toBe(
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
