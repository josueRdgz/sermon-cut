import { describe, expect, it } from 'vitest';

import {
  collectLaneOccupants,
  laneConflict,
  occupantId,
  placeOnLane,
  placeTextOverlay,
  resolveExclusiveLane,
  settleExclusiveLanes,
  snapToFit,
} from './laneOccupancy';

describe('laneOccupancy', () => {
  it('detects overlap on the same lane', () => {
    const hit = laneConflict(
      [{ id: 'caption:a', kind: 'caption', start: 0, end: 4 }],
      { id: 'overlay:b', kind: 'overlay', start: 2, end: 6 },
    );
    expect(hit?.id).toBe('caption:a');
  });

  it('allows sequential clips that only touch', () => {
    expect(
      laneConflict(
        [{ id: 'segment:a', kind: 'segment', start: 0, end: 4 }],
        { id: 'segment:b', kind: 'segment', start: 4, end: 8 },
      ),
    ).toBeNull();
  });

  it('snaps a caption to sit after the blocking clip', () => {
    const next = snapToFit(
      [{ id: 'segment:a', kind: 'segment', start: 0, end: 5 }],
      { id: 'caption:c', kind: 'caption', start: 2, end: 4 },
      20,
    );
    expect(next?.start).toBeCloseTo(5);
    expect(next?.end).toBeCloseTo(7);
  });

  it('keeps the preferred lane when it is free', () => {
    const byLane = collectLaneOccupants({
      laneCount: 3,
      clips: [{ id: 'a', lane: 1, start: 0, end: 4 }],
      captions: [],
      overlays: [],
      musicLane: 0,
      musicEnd: 10,
    });
    expect(
      resolveExclusiveLane(
        byLane,
        { id: occupantId('caption', 'c'), kind: 'caption', start: 0, end: 3 },
        3,
        2,
      ),
    ).toBe(2);
  });

  it('rejects stacking a caption on the video lane at the same time', () => {
    const byLane = collectLaneOccupants({
      laneCount: 3,
      clips: [{ id: 'a', lane: 1, start: 0, end: 4 }],
      captions: [],
      overlays: [],
      musicLane: 0,
      musicEnd: 10,
    });
    expect(
      resolveExclusiveLane(
        byLane,
        { id: occupantId('caption', 'c'), kind: 'caption', start: 1, end: 3 },
        3,
        1,
      ),
    ).toBe(2);
  });

  it('sits captions and overlays flush after the video on the same lane', () => {
    const byLane = collectLaneOccupants({
      laneCount: 3,
      clips: [{ id: 'a', lane: 1, start: 0, end: 8 }],
      captions: [{ id: 'c', lane: 1, start: 1, end: 3 }],
      overlays: [{ id: 's', lane: 1, start: 2, end: 4 }],
      musicLane: 0,
      musicEnd: 10,
    });
    const settled = settleExclusiveLanes(byLane, 3);
    expect(settled.assignments.get(occupantId('segment', 'a'))).toBe(1);
    expect(settled.assignments.get(occupantId('caption', 'c'))).toBe(1);
    expect(settled.assignments.get(occupantId('overlay', 's'))).toBe(1);
    expect(settled.times.get(occupantId('caption', 'c'))).toEqual({ start: 8, end: 10 });
    expect(settled.times.get(occupantId('overlay', 's'))).toEqual({ start: 10, end: 12 });
  });

  it('places a video overlay flush after the last clip on the lane', () => {
    const next = placeOnLane(
      [{ id: 'segment:a', kind: 'segment', start: 0, end: 41 }],
      { id: 'overlay:v', kind: 'overlay', start: 5, end: 15 },
    );
    expect(next.start).toBeCloseTo(41);
    expect(next.end).toBeCloseTo(51);
  });

  it('puts text on an empty lane instead of on the video', () => {
    const byLane = collectLaneOccupants({
      laneCount: 2,
      clips: [{ id: 'a', lane: 1, start: 0, end: 40 }],
      captions: [{ id: 'c', lane: 0, start: 0, end: 40 }],
      overlays: [],
      musicLane: null,
      musicEnd: 0,
    });
    const packed = placeTextOverlay(
      byLane,
      { id: occupantId('text', 't'), kind: 'text', start: 0, end: 3 },
      2,
      1,
    );
    expect(packed.lane).not.toBe(1);
    expect(packed.laneCount).toBeGreaterThanOrEqual(3);
    expect(packed.occupant.start).toBe(0);
  });

  it('settles text off the video lane onto a free line', () => {
    const byLane = collectLaneOccupants({
      laneCount: 2,
      clips: [{ id: 'a', lane: 1, start: 0, end: 8 }],
      captions: [],
      overlays: [{ id: 't', lane: 1, start: 1, end: 4, asText: true }],
      musicLane: null,
      musicEnd: 0,
    });
    const settled = settleExclusiveLanes(byLane, 2);
    expect(settled.assignments.get(occupantId('segment', 'a'))).toBe(1);
    expect(settled.assignments.get(occupantId('text', 't'))).not.toBe(1);
    expect(settled.times.get(occupantId('text', 't'))).toEqual({ start: 1, end: 4 });
  });
});
