import { describe, expect, it } from 'vitest';

import {
  collectLaneOccupants,
  laneConflict,
  occupantId,
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

  it('moves a caption off the video lane instead of stacking', () => {
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
    expect(settled.assignments.get(occupantId('caption', 'c'))).not.toBe(1);
    expect(settled.assignments.get(occupantId('overlay', 's'))).not.toBe(1);
    expect(settled.assignments.get(occupantId('caption', 'c'))).not.toBe(
      settled.assignments.get(occupantId('overlay', 's')),
    );
    expect(settled.laneCount).toBeGreaterThanOrEqual(4);
  });
});
