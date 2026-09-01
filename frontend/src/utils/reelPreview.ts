import type { ReelSegment } from '../types/reel';
import { buildOutputClock, outputTimeForSource } from './reelOutputClock';

export interface PreviewSeekTarget {
  outputTime: number;
  segmentIndex: number;
  sourceTime: number;
}

function segmentSignature(segments: ReelSegment[]): string {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const payload = ordered.map((segment) => [
    segment.id,
    segment.order,
    Math.round(segment.source_start_seconds * 1000) / 1000,
    Math.round(segment.source_end_seconds * 1000) / 1000,
    segment.transition_type,
    segment.transition_duration_ms,
  ]);
  return JSON.stringify(payload);
}

/** Stable key for resetting preview when cuts/transitions change (not metadata). */
export function previewTimelineIdentity(
  reelId: string | null | undefined,
  segments: ReelSegment[],
): string {
  return `${reelId ?? 'none'}:${segmentSignature(segments)}`;
}

/** Map output-clock time to a source window (xfade-aware, matches buildOutputClock). */
export function resolvePreviewSeek(
  segments: ReelSegment[],
  requestedOutputTime: number,
): PreviewSeekTarget | null {
  if (segments.length === 0) return null;

  const clock = buildOutputClock(segments);
  const total = clock.totalDuration;
  if (!(total > 0)) return null;

  const finiteRequest = Number.isFinite(requestedOutputTime) ? requestedOutputTime : 0;
  const outputTime = Math.max(0, Math.min(finiteRequest, total));
  const { placements } = clock;

  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const next = placements[index + 1];
    if (next && outputTime >= next.outputStart) {
      continue;
    }
    const localTime = Math.max(
      0,
      Math.min(outputTime - placement.outputStart, placement.contentDuration),
    );
    return {
      outputTime,
      segmentIndex: index,
      sourceTime: placement.sourceStart + localTime,
    };
  }

  const last = placements[placements.length - 1];
  return {
    outputTime,
    segmentIndex: placements.length - 1,
    sourceTime: last.sourceEnd,
  };
}

export interface PlayheadAfterTrim {
  segmentIndex: number;
  sourceTime: number;
  outputTime: number;
  /** True when the source clock left the current window and the video must seek. */
  seekRequired: boolean;
}

/**
 * Keep the program playhead on the clip being edited after an in/out change.
 * Do not jump to the first fragment; only seek if the current source time
 * fell outside the (possibly shortened) window.
 */
export function playheadAfterTrim(
  segments: ReelSegment[],
  segmentIndex: number,
  sourceTime: number,
): PlayheadAfterTrim | null {
  if (segments.length === 0) return null;
  const index = Math.max(0, Math.min(segmentIndex, segments.length - 1));
  const current = segments[index];
  let nextIndex = index;
  let nextSource = sourceTime;
  let seekRequired = false;

  if (sourceTime < current.source_start_seconds) {
    nextSource = current.source_start_seconds;
    seekRequired = true;
  } else if (sourceTime > current.source_end_seconds) {
    if (index + 1 < segments.length) {
      nextIndex = index + 1;
      nextSource = segments[nextIndex].source_start_seconds;
    } else {
      nextSource = Math.max(
        current.source_start_seconds,
        current.source_end_seconds - 0.04,
      );
    }
    seekRequired = true;
  }

  return {
    segmentIndex: nextIndex,
    sourceTime: nextSource,
    outputTime: outputTimeForSource(buildOutputClock(segments), nextIndex, nextSource),
    seekRequired,
  };
}
