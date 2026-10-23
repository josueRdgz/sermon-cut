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

/** Convert a pixel offset (or drag delta) back to seconds. Sign is preserved. */
export function pxToTime(px: number, pxPerSecond: number): number {
  if (!(pxPerSecond > 0) || !Number.isFinite(px)) return 0;
  return px / pxPerSecond;
}

const MIN_CAPTION_MS = 200;

/** Slide or trim a caption on the output clock without shrinking past 200 ms. */
export function shiftCaptionWindow(
  inMs: number,
  outMs: number,
  deltaMs: number,
  edge: 'move' | 'start' | 'end',
  totalMs: number,
): { inMs: number; outMs: number } {
  const total = Math.max(MIN_CAPTION_MS, totalMs);
  const width = Math.max(MIN_CAPTION_MS, outMs - inMs);
  let nextIn = inMs;
  let nextOut = outMs;
  if (edge === 'move') {
    nextIn = Math.max(0, Math.min(total - width, inMs + deltaMs));
    nextOut = nextIn + width;
  } else if (edge === 'start') {
    nextIn = Math.max(0, Math.min(outMs - MIN_CAPTION_MS, inMs + deltaMs));
  } else {
    nextOut = Math.max(inMs + MIN_CAPTION_MS, Math.min(total, outMs + deltaMs));
  }
  return { inMs: Math.round(nextIn), outMs: Math.round(nextOut) };
}

export interface SourceGapSpan {
  /** Output-clock join where the source sermon skips ahead. */
  leftRatio: number;
  afterIndex: number;
  beforeSegmentId: string;
  afterSegmentId: string;
  sourceSeconds: number;
}

/** Source-sermon holes between kept clips (not present on the output clock). */
export function buildSourceGaps(segments: ReelSegment[]): SourceGapSpan[] {
  if (segments.length < 2) return [];
  const clock = buildOutputClock(segments);
  const gaps: SourceGapSpan[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const hole = current.source_start_seconds - previous.source_end_seconds;
    if (hole <= 0.35) continue;
    const placement = clock.placements[index];
    if (!placement) continue;
    gaps.push({
      leftRatio: placement.outputStart / Math.max(clock.totalDuration, 0.01),
      afterIndex: index,
      beforeSegmentId: previous.id,
      afterSegmentId: current.id,
      sourceSeconds: hole,
    });
  }
  return gaps;
}
