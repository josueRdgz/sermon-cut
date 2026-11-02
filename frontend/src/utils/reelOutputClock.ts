import type { ReelSegment } from '../types/reel';

/** Keep in sync with backend ``services.subtitles.timeline``. */
const XFADE_TRANSITIONS = new Set([
  'short_crossfade',
  'dip_to_black',
  'fade',
  'flash',
  'light_change',
  'wipe_down',
  'wipe_left',
  'slide_down',
  'dissolve',
]);
const MIN_XFADE_SLACK = 0.05;

export interface OutputPlacement {
  id: string;
  index: number;
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  contentDuration: number;
  /** Silent black before this clip's picture on the output clock. */
  padSeconds: number;
  /** Usable xfade after this clip; 0 for the last clip or a hard cut. */
  overlapSeconds: number;
}

export const MAX_PAD_BEFORE_MS = 120_000;

export function clampPadBeforeMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_PAD_BEFORE_MS, Math.round(value)));
}

export function padBeforeSeconds(segment: { pad_before_ms?: number | null }): number {
  return clampPadBeforeMs(segment.pad_before_ms ?? 0) / 1000;
}

export interface OutputClock {
  placements: OutputPlacement[];
  totalDuration: number;
}

function usableTransitionSeconds(
  transitionType: string,
  transitionDurationMs: number,
  timelineSoFar: number,
  nextDuration: number,
): number {
  if (!XFADE_TRANSITIONS.has(transitionType)) return 0;
  const requested = Math.max(0, transitionDurationMs) / 1000;
  const usable = Math.min(
    requested,
    timelineSoFar - MIN_XFADE_SLACK,
    nextDuration - MIN_XFADE_SLACK,
  );
  return usable > 0 ? usable : 0;
}

/** Place source windows on the assembled output clock (xfade-aware). */
export function buildOutputClock(segments: ReelSegment[]): OutputClock {
  if (segments.length === 0) {
    return { placements: [], totalDuration: 0 };
  }

  const placements: OutputPlacement[] = [];
  let total = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const duration = Math.max(0, segment.duration_seconds);
    const pad = padBeforeSeconds(segment);
    const streamDuration = pad + duration;
    let streamStart = 0;
    if (index === 0) {
      total = streamDuration;
    } else {
      const previous = segments[index - 1];
      const usable = usableTransitionSeconds(
        previous.transition_type,
        previous.transition_duration_ms,
        total,
        streamDuration,
      );
      streamStart = usable > 0 ? total - usable : total;
      total = streamStart + streamDuration;
    }
    const placement: OutputPlacement = {
      id: segment.id,
      index,
      sourceStart: segment.source_start_seconds,
      sourceEnd: segment.source_end_seconds,
      outputStart: streamStart + pad,
      contentDuration: duration,
      padSeconds: pad,
      overlapSeconds: 0,
    };
    placements.push(placement);

    if (index + 1 < segments.length) {
      const next = segments[index + 1];
      const overlap = usableTransitionSeconds(
        segment.transition_type,
        segment.transition_duration_ms,
        total,
        padBeforeSeconds(next) + Math.max(0, next.duration_seconds),
      );
      placement.overlapSeconds = overlap;
    }
  }

  return { placements, totalDuration: total };
}

export function outputTimeForSource(
  clock: OutputClock,
  index: number,
  sourceTime: number,
): number {
  const placement = clock.placements[index];
  if (!placement) return 0;
  const local = Math.max(
    0,
    Math.min(sourceTime - placement.sourceStart, placement.contentDuration),
  );
  return placement.outputStart + local;
}

/** True when the next clip starts where the current one ends (no source gap). */
export function sourceWindowsContiguous(
  current: { source_end_seconds: number },
  next: { source_start_seconds: number },
  slack = 0.08,
): boolean {
  return Math.abs(next.source_start_seconds - current.source_end_seconds) <= slack;
}

/** Map a sermon timestamp onto the output clock, or null if that time was cut. */
export function outputTimeAtSource(clock: OutputClock, sourceTime: number): number | null {
  for (const placement of clock.placements) {
    if (sourceTime >= placement.sourceStart && sourceTime <= placement.sourceEnd) {
      const local = Math.min(
        Math.max(0, sourceTime - placement.sourceStart),
        placement.contentDuration,
      );
      return placement.outputStart + local;
    }
  }
  return null;
}

export function transitionMarkerAt(
  placements: OutputPlacement[],
  segments: ReelSegment[],
): { leftRatio: number; type: string }[] {
  const total = placements.reduce(
    (max, item) => Math.max(max, item.outputStart + item.contentDuration),
    0,
  );
  if (!(total > 0)) return [];
  const markers: { leftRatio: number; type: string }[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (segment.transition_type === 'hard_cut') continue;
    const next = placements[i + 1];
    if (!next) continue;
    markers.push({
      leftRatio: next.outputStart / total,
      type: segment.transition_type,
    });
  }
  return markers;
}
