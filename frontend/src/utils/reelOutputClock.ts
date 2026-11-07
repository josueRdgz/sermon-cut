import { XFADE_TRANSITION_TYPES, type ReelSegment } from '../types/reel';

/** Keep in sync with backend ``services.subtitles.timeline``. */
const XFADE_TRANSITIONS = new Set<string>(XFADE_TRANSITION_TYPES);
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
  /** Start on the sequential edit timeline (clips never overlap). */
  editStart: number;
}

export const MAX_PAD_BEFORE_MS = 120_000;
export const DEFAULT_TRANSITION_MS = 350;

export function clampPadBeforeMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_PAD_BEFORE_MS, Math.round(value)));
}

export function padBeforeSeconds(segment: { pad_before_ms?: number | null }): number {
  return clampPadBeforeMs(segment.pad_before_ms ?? 0) / 1000;
}

export interface OutputClock {
  placements: OutputPlacement[];
  /** Program duration after xfade overlap. */
  totalDuration: number;
  /** Visual timeline duration; clips stay sequential and do not slide. */
  editDuration: number;
}

export interface TransitionBand {
  leftRatio: number;
  widthRatio: number;
  centerRatio: number;
  type: string;
  overlapSeconds: number;
  segmentId: string;
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

function clampTime(value: number, max: number): number {
  if (!(max > 0)) return 0;
  const finite = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(finite, max));
}

/** Place source windows on the assembled output clock (xfade-aware). */
export function buildOutputClock(segments: ReelSegment[]): OutputClock {
  if (segments.length === 0) {
    return { placements: [], totalDuration: 0, editDuration: 0 };
  }

  const placements: OutputPlacement[] = [];
  let total = 0;
  let editCursor = 0;

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
    const editStart = editCursor + pad;
    const placement: OutputPlacement = {
      id: segment.id,
      index,
      sourceStart: segment.source_start_seconds,
      sourceEnd: segment.source_end_seconds,
      outputStart: streamStart + pad,
      contentDuration: duration,
      padSeconds: pad,
      overlapSeconds: 0,
      editStart,
    };
    placements.push(placement);
    editCursor = editStart + duration;

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

  return { placements, totalDuration: total, editDuration: editCursor };
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

/**
 * Map program time onto the sequential edit timeline.
 * During an xfade the needle covers both clip ends (2×) so fragments do not slide.
 */
export function editTimeFromOutput(clock: OutputClock, outputTime: number): number {
  if (!(clock.editDuration > 0)) return 0;
  const t = clampTime(outputTime, clock.totalDuration);
  const { placements } = clock;
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const next = placements[index + 1];
    const overlap = placement.overlapSeconds;
    const uniqueEnd = placement.outputStart + placement.contentDuration - overlap;
    const contentEnd = placement.outputStart + placement.contentDuration;
    const padStart = Math.max(0, placement.outputStart - placement.padSeconds);

    if (t < padStart) continue;

    if (next && overlap > 0 && t >= uniqueEnd && t < contentEnd) {
      const progress = (t - uniqueEnd) / overlap;
      return (
        placement.editStart + placement.contentDuration - overlap + progress * 2 * overlap
      );
    }

    if (next && t >= contentEnd && t >= next.outputStart - next.padSeconds) {
      continue;
    }

    if (t < placement.outputStart) {
      return placement.editStart - (placement.outputStart - t);
    }
    return placement.editStart + (t - placement.outputStart);
  }
  return clock.editDuration;
}

/** Inverse of ``editTimeFromOutput``: a click on the sequential board maps to program time. */
export function outputTimeFromEdit(clock: OutputClock, editTime: number): number {
  if (!(clock.totalDuration > 0)) return 0;
  const t = clampTime(editTime, clock.editDuration);
  const { placements } = clock;
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const next = placements[index + 1];
    const overlap = placement.overlapSeconds;
    const uniqueEditEnd = placement.editStart + placement.contentDuration - overlap;
    const mixEditEnd = uniqueEditEnd + 2 * overlap;
    const padEditStart = placement.editStart - placement.padSeconds;
    const uniqueOutEnd = placement.outputStart + placement.contentDuration - overlap;

    if (t < padEditStart) continue;

    if (t < placement.editStart) {
      return placement.outputStart - (placement.editStart - t);
    }

    if (next && overlap > 0 && t >= uniqueEditEnd && t < mixEditEnd) {
      const progress = (t - uniqueEditEnd) / (2 * overlap);
      return uniqueOutEnd + progress * overlap;
    }

    if (next && t >= placement.editStart + placement.contentDuration && t >= next.editStart - next.padSeconds) {
      continue;
    }

    return placement.outputStart + (t - placement.editStart);
  }
  return clock.totalDuration;
}

/** Transition sits on the cut, covering the end of A and the start of B. */
export function transitionMarkerAt(
  clock: OutputClock,
  segments: ReelSegment[],
): TransitionBand[] {
  const total = clock.editDuration;
  if (!(total > 0)) return [];
  const markers: TransitionBand[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const placement = clock.placements[index];
    if (!placement || segment.transition_type === 'hard_cut' || placement.overlapSeconds <= 0) {
      continue;
    }
    const overlap = placement.overlapSeconds;
    const cut = placement.editStart + placement.contentDuration;
    const left = Math.max(0, cut - overlap);
    markers.push({
      leftRatio: left / total,
      widthRatio: (overlap * 2) / total,
      centerRatio: cut / total,
      type: segment.transition_type,
      overlapSeconds: overlap,
      segmentId: segment.id,
    });
  }
  return markers;
}
