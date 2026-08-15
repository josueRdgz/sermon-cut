import type { ReelSegment } from '../types/reel';

/** Keep in sync with backend ``services.subtitles.timeline``. */
const XFADE_TRANSITIONS = new Set([
  'short_crossfade',
  'dip_to_black',
  'fade',
  'flash',
]);
const MIN_XFADE_SLACK = 0.05;

export interface OutputPlacement {
  id: string;
  index: number;
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  contentDuration: number;
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
  let outputCursor = 0;
  let total = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const duration = Math.max(0, segment.duration_seconds);
    placements.push({
      id: segment.id,
      index,
      sourceStart: segment.source_start_seconds,
      sourceEnd: segment.source_end_seconds,
      outputStart: outputCursor,
      contentDuration: duration,
    });

    if (index === 0) {
      total = duration;
    } else {
      const previous = segments[index - 1];
      const usable = usableTransitionSeconds(
        previous.transition_type,
        previous.transition_duration_ms,
        total,
        duration,
      );
      total += duration - usable;
    }

    if (index + 1 < segments.length) {
      const next = segments[index + 1];
      const usable = usableTransitionSeconds(
        segment.transition_type,
        segment.transition_duration_ms,
        total,
        Math.max(0, next.duration_seconds),
      );
      outputCursor = usable > 0 ? total - usable : total;
    }
  }

  return { placements, totalDuration: total };
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
