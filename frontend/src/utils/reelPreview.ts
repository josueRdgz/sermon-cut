import type { ReelSegment } from '../types/reel';
import { buildOutputClock } from './reelOutputClock';

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
