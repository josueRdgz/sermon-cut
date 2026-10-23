import { describe, expect, it } from 'vitest';

import {
  assignLanes,
  clampLane,
  defaultLaneLayout,
  insertLane,
  laneForCaption,
  laneForSegment,
  remapAfterRemove,
  removeLane,
} from './nleLanes';

describe('nleLanes', () => {
  it('clamps a lane into the strip range', () => {
    expect(clampLane(-2, 3)).toBe(0);
    expect(clampLane(9, 3)).toBe(2);
    expect(clampLane(1, 3)).toBe(1);
  });

  it('defaults captions just above the video lane', () => {
    const layout = defaultLaneLayout();
    expect(layout.videoLane).toBe(1);
    expect(laneForCaption(layout, 'seg-1')).toBe(2);
    expect(laneForCaption({ ...layout, captionLanes: { 'seg-1': 0 } }, 'seg-1')).toBe(0);
  });

  it('keeps video clips on the video lane until assigned', () => {
    const layout = defaultLaneLayout();
    expect(laneForSegment(layout, 'a')).toBe(1);
    expect(laneForSegment({ ...layout, segmentLanes: { a: 0 } }, 'a')).toBe(0);
  });

  it('inserts a lane above and shifts assignments down', () => {
    const layout = insertLane(
      {
        ...defaultLaneLayout(),
        segmentLanes: { a: 1 },
        captionLanes: { a: 0 },
        musicLane: 2,
      },
      0,
    );
    expect(layout.laneCount).toBe(4);
    expect(layout.videoLane).toBe(2);
    expect(layout.segmentLanes.a).toBe(2);
    expect(layout.captionLanes.a).toBe(1);
    expect(layout.musicLane).toBe(3);
  });

  it('moves selected clips onto another lane', () => {
    const next = assignLanes(defaultLaneLayout(), ['a', 'b'], 0, 'segmentLanes');
    expect(next.segmentLanes).toEqual({ a: 0, b: 0 });
    expect(laneForSegment(next, 'a')).toBe(0);
  });

  it('removes a middle lane and parks its clips on the neighbor', () => {
    const next = removeLane(
      {
        ...defaultLaneLayout(),
        laneCount: 4,
        videoLane: 1,
        segmentLanes: { a: 1, b: 2 },
        captionLanes: { a: 3 },
        musicLane: 0,
      },
      2,
    );
    expect(next.laneCount).toBe(3);
    expect(next.videoLane).toBe(1);
    expect(next.segmentLanes).toEqual({ a: 1, b: 1 });
    expect(next.captionLanes).toEqual({ a: 2 });
    expect(next.musicLane).toBe(0);
    expect(remapAfterRemove(2, 2)).toBe(1);
    expect(remapAfterRemove(3, 2)).toBe(2);
  });

  it('keeps at least two lanes', () => {
    const layout = defaultLaneLayout();
    expect(layout.laneCount).toBe(3);
    const once = removeLane(layout, 0);
    expect(once.laneCount).toBe(2);
    expect(removeLane(once, 0).laneCount).toBe(2);
  });
});
