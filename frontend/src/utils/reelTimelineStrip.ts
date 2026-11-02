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

/**
 * Reorder packed video clips by dropping onto another clip.
 * Left half of the target inserts before it; right half inserts after.
 * Returns null when the order would not change.
 */
export function reorderIdsOnDrop(
  ids: string[],
  movingIds: string[],
  targetId: string,
  dropAfter: boolean,
): string[] | null {
  if (movingIds.includes(targetId)) return null;
  const moving = ids.filter((id) => movingIds.includes(id));
  const rest = ids.filter((id) => !movingIds.includes(id));
  let insertAt = rest.indexOf(targetId);
  if (moving.length === 0 || insertAt < 0) return null;
  if (dropAfter) insertAt += 1;
  rest.splice(insertAt, 0, ...moving);
  if (rest.length !== ids.length || rest.every((id, index) => id === ids[index])) return null;
  return rest;
}

const REORDER_MIN_PX = 36;

/**
 * Reorder packed clips by how far the block has been dragged.
 * Crossing ~36px (or half of a short neighbor) swaps past it.
 */
export function reorderIdsByDelta(
  spans: Array<{ id: string; duration: number }>,
  movingIds: string[],
  deltaSeconds: number,
  pxPerSecond = 40,
): string[] | null {
  const ids = spans.map((span) => span.id);
  const movingSet = new Set(movingIds);
  const movingOrdered = ids.filter((id) => movingSet.has(id));
  const rest = spans.filter((span) => !movingSet.has(span.id));
  if (movingOrdered.length === 0 || rest.length === 0 || !Number.isFinite(deltaSeconds)) return null;
  const movingDuration = movingOrdered.reduce((sum, id) => {
    const span = spans.find((item) => item.id === id);
    return sum + (span?.duration ?? 0);
  }, 0);
  const maxThreshold = REORDER_MIN_PX / Math.max(pxPerSecond, 1);

  let originRestIndex = 0;
  for (const span of spans) {
    if (movingSet.has(span.id)) break;
    originRestIndex += 1;
  }

  let insertAt = originRestIndex;
  if (deltaSeconds > 0) {
    let traveled = 0;
    for (let index = originRestIndex; index < rest.length; index += 1) {
      const threshold = Math.min(rest[index].duration / 2, movingDuration / 2, maxThreshold);
      if (deltaSeconds < traveled + threshold) break;
      traveled += rest[index].duration;
      insertAt = index + 1;
    }
  } else if (deltaSeconds < 0) {
    let traveled = 0;
    for (let index = originRestIndex - 1; index >= 0; index -= 1) {
      const threshold = Math.min(rest[index].duration / 2, movingDuration / 2, maxThreshold);
      if (-deltaSeconds < traveled + threshold) break;
      traveled += rest[index].duration;
      insertAt = index;
    }
  }

  const next = rest.map((span) => span.id);
  next.splice(insertAt, 0, ...movingOrdered);
  if (next.length !== ids.length || next.every((id, index) => id === ids[index])) return null;
  return next;
}

/**
 * Packed A-roll drop target from a pointer on the output clock.
 * Hits before the first remaining clip go to the start; past the last go to the end.
 */
export function dropAnchorFromPointer(
  spans: Pick<TimelineClipSpan, 'id' | 'start' | 'duration'>[],
  outputSeconds: number,
  movingIds: string[],
): { targetId: string; dropAfter: boolean } | null {
  const others = spans.filter((span) => !movingIds.includes(span.id));
  if (others.length === 0) return null;
  const first = others[0];
  if (outputSeconds <= first.start) {
    return { targetId: first.id, dropAfter: false };
  }
  const last = others[others.length - 1];
  if (outputSeconds >= last.start + last.duration) {
    return { targetId: last.id, dropAfter: true };
  }
  const hit =
    others.find(
      (span) => outputSeconds >= span.start && outputSeconds < span.start + span.duration,
    ) ?? null;
  if (!hit) return null;
  return {
    targetId: hit.id,
    dropAfter: outputSeconds >= hit.start + hit.duration / 2,
  };
}

/**
 * Close the gap the lifted clips leave so neighbors slide in during a drag.
 * The moving clips keep their original spans and follow the pointer in the UI.
 */
export function packRestClosed(
  spans: TimelineClipSpan[],
  movingIds: string[],
  totalDuration: number,
): TimelineClipSpan[] {
  const rest = spans.filter((span) => !movingIds.includes(span.id));
  const total = Math.max(totalDuration, 0.01);
  let time = 0;
  return rest.map((span) => {
    const next: TimelineClipSpan = {
      ...span,
      start: time,
      leftRatio: time / total,
      widthRatio: span.duration / total,
    };
    time += span.duration;
    return next;
  });
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
