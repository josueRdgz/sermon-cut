export interface HighlightPreviewClip {
  start: number;
  end: number;
}

export interface HighlightPreviewSeek {
  outputTime: number;
  segmentIndex: number;
  sourceTime: number;
}

export function highlightAssembledDuration(segments: HighlightPreviewClip[]): number {
  return segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
}

export function highlightPreviewIdentity(segments: HighlightPreviewClip[]): string {
  return segments.map((segment) => `${segment.start.toFixed(3)}-${segment.end.toFixed(3)}`).join('|');
}

export function resolveHighlightPreviewSeek(
  segments: HighlightPreviewClip[],
  requestedOutputTime: number,
): HighlightPreviewSeek | null {
  if (segments.length === 0) return null;

  const total = highlightAssembledDuration(segments);
  const finiteRequest = Number.isFinite(requestedOutputTime) ? requestedOutputTime : 0;
  const outputTime = Math.max(0, Math.min(finiteRequest, total));
  let elapsed = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const duration = Math.max(0, segment.end - segment.start);
    const isLast = index === segments.length - 1;
    if (outputTime < elapsed + duration || isLast) {
      const localTime = Math.max(0, Math.min(outputTime - elapsed, duration));
      return {
        outputTime,
        segmentIndex: index,
        sourceTime: segment.start + localTime,
      };
    }
    elapsed += duration;
  }

  return null;
}
