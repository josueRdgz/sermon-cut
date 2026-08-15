import type { ReelSegment } from '../types/reel';
import { buildOutputClock, type OutputPlacement } from './reelOutputClock';

export interface TimelineClipSpan {
  id: string;
  index: number;
  /** Start on the output clock (seconds). */
  start: number;
  /** Duration on the output clock (seconds). */
  duration: number;
  /** Width as fraction of total [0, 1]. */
  widthRatio: number;
  /** Left offset as fraction of total [0, 1]. */
  leftRatio: number;
}

/** Build proportional clip spans using the xfade-aware output clock. */
export function buildClipSpans(segments: ReelSegment[]): TimelineClipSpan[] {
  const clock = buildOutputClock(segments);
  const total = clock.totalDuration;
  if (!(total > 0)) return [];

  return clock.placements.map((placement: OutputPlacement) => ({
    id: placement.id,
    index: placement.index,
    start: placement.outputStart,
    duration: placement.contentDuration,
    leftRatio: placement.outputStart / total,
    widthRatio: placement.contentDuration / total,
  }));
}

/** Map a click position (0–1 along the track) to an output time. */
export function outputTimeFromTrackRatio(ratio: number, totalDuration: number): number {
  if (!(totalDuration > 0)) return 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  return clamped * totalDuration;
}

/** Playhead left as a percentage string for CSS. */
export function playheadPercent(outputTime: number, totalDuration: number): number {
  if (!(totalDuration > 0)) return 0;
  return Math.max(0, Math.min(100, (outputTime / totalDuration) * 100));
}

/** Convert output time to a horizontal pixel offset at the current zoom. */
export function timeToPx(time: number, pxPerSecond: number): number {
  return Math.max(0, time) * pxPerSecond;
}

/** Convert a pixel offset back to output seconds. */
export function pxToTime(px: number, pxPerSecond: number): number {
  if (!(pxPerSecond > 0)) return 0;
  return Math.max(0, px / pxPerSecond);
}
