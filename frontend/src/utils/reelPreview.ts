import type { ReelSegment } from '../types/reel';

export interface PreviewSeekTarget {
  outputTime: number;
  segmentIndex: number;
  sourceTime: number;
}

export function previewTimelineIdentity(
  reelId: string | null | undefined,
  segments: ReelSegment[],
): string {
  return `${reelId ?? 'none'}:${segments[0]?.id ?? 'empty'}`;
}

export function resolvePreviewSeek(
  segments: ReelSegment[],
  requestedOutputTime: number,
): PreviewSeekTarget | null {
  if (segments.length === 0) return null;

  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.duration_seconds), 0);
  const finiteRequest = Number.isFinite(requestedOutputTime) ? requestedOutputTime : 0;
  const outputTime = Math.max(0, Math.min(finiteRequest, total));
  let elapsed = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const duration = Math.max(0, segment.duration_seconds);
    const isLast = index === segments.length - 1;

    // An exact cut boundary belongs to the following fragment. This avoids
    // asking WebKit to decode the final frame of one range before immediately
    // jumping to the next range.
    if (outputTime < elapsed + duration || isLast) {
      const localTime = Math.max(0, Math.min(outputTime - elapsed, duration));
      return {
        outputTime,
        segmentIndex: index,
        sourceTime: segment.source_start_seconds + localTime,
      };
    }
    elapsed += duration;
  }

  return null;
}
