import { describe, expect, it } from 'vitest';

import type { ReelSegment } from '../types/reel';
import {
  buildClipSpans,
  buildSourceGaps,
  dropAnchorFromPointer,
  packRestClosed,
  outputTimeFromTrackRatio,
  playheadPercent,
  pxToTime,
  reorderIdsByDelta,
  reorderIdsOnDrop,
  shiftCaptionWindow,
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

  it('shifts a clip right when it has a leading pad, leaving empty track behind', () => {
    const spans = buildClipSpans([
      { ...seg('a', 8, 0), pad_before_ms: 2000 },
      seg('b', 8, 1),
    ]);
    expect(spans[0].start).toBeCloseTo(2);
    expect(spans[0].leftRatio).toBeCloseTo(2 / 18);
    expect(spans[1].start).toBeCloseTo(10);
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

describe('shiftCaptionWindow', () => {
  it('slides a caption left down to 0 without changing its width', () => {
    const next = shiftCaptionWindow(4000, 7000, -5000, 'move', 30_000);
    expect(next.inMs).toBe(0);
    expect(next.outMs).toBe(3000);
  });

  it('keeps a negative pixel delta so the caption can travel left', () => {
    const deltaMs = Math.round(pxToTime(-80, 40) * 1000);
    const next = shiftCaptionWindow(4000, 7000, deltaMs, 'move', 30_000);
    expect(next.inMs).toBe(2000);
    expect(next.outMs).toBe(5000);
  });

  it('slides a caption right without stretching it', () => {
    const next = shiftCaptionWindow(0, 3000, 1500, 'move', 30_000);
    expect(next.inMs).toBe(1500);
    expect(next.outMs).toBe(4500);
  });
});

describe('pxToTime', () => {
  it('keeps the sign of a drag delta so clips can move left', () => {
    expect(pxToTime(-80, 40)).toBeCloseTo(-2);
    expect(pxToTime(80, 40)).toBeCloseTo(2);
  });
});

describe('reorderIdsByDelta', () => {
  const spans = [
    { id: 'a', duration: 4 },
    { id: 'b', duration: 4 },
    { id: 'c', duration: 4 },
  ];

  it('moves the first clip after the next one when dragged past a short threshold', () => {
    expect(reorderIdsByDelta(spans, ['a'], 1.2, 40)).toEqual(['b', 'a', 'c']);
  });

  it('does not reorder on a tiny nudge', () => {
    expect(reorderIdsByDelta(spans, ['a'], 0.4, 40)).toBeNull();
  });

  it('lets a later clip sit to the left of the previous one', () => {
    expect(reorderIdsByDelta(spans, ['c'], -3)).toEqual(['a', 'c', 'b']);
  });

  it('moves a clip all the way to the start', () => {
    expect(reorderIdsByDelta(spans, ['c'], -7)).toEqual(['c', 'a', 'b']);
  });
});

describe('reorderIdsOnDrop', () => {
  const ids = ['a', 'b', 'c'];

  it('lets the left-most clip move after a later one', () => {
    expect(reorderIdsOnDrop(ids, ['a'], 'b', true)).toEqual(['b', 'a', 'c']);
  });

  it('lets a later clip move to the start', () => {
    expect(reorderIdsOnDrop(ids, ['c'], 'a', false)).toEqual(['c', 'a', 'b']);
  });

  it('does nothing when dropping onto itself', () => {
    expect(reorderIdsOnDrop(ids, ['a'], 'a', true)).toBeNull();
  });
});

describe('dropAnchorFromPointer', () => {
  const spans = [
    { id: 'a', start: 0, duration: 4 },
    { id: 'b', start: 4, duration: 4 },
    { id: 'c', start: 8, duration: 4 },
  ];

  it('inserts the dragged clip at the start when the pointer is before everyone else', () => {
    expect(dropAnchorFromPointer(spans, 0.2, ['c'])).toEqual({ targetId: 'a', dropAfter: false });
  });

  it('inserts after the last remaining clip when the pointer is past the end', () => {
    expect(dropAnchorFromPointer(spans, 11.5, ['a'])).toEqual({ targetId: 'c', dropAfter: true });
  });

  it('uses the right half of a clip as insert-after', () => {
    expect(dropAnchorFromPointer(spans, 6.5, ['a'])).toEqual({ targetId: 'b', dropAfter: true });
  });
});

describe('packRestClosed', () => {
  it('slides the remaining clips to the start while one is lifted', () => {
    const packed = packRestClosed(
      [
        { id: 'a', index: 0, start: 0, duration: 4, leftRatio: 0, widthRatio: 0.4 },
        { id: 'b', index: 1, start: 4, duration: 6, leftRatio: 0.4, widthRatio: 0.6 },
      ],
      ['a'],
      10,
    );
    expect(packed).toHaveLength(1);
    expect(packed[0].id).toBe('b');
    expect(packed[0].start).toBe(0);
    expect(packed[0].leftRatio).toBeCloseTo(0);
  });
});

