import type { ReelSegment } from '../types/reel';

const MIN_DURATION = 0.2;
const JOIN_EPSILON = 0.05;
export const SPLIT_EDGE_MARGIN = 0.2;

export function splitTooCloseToEdge(
  start: number,
  cut: number,
  end: number,
  margin = SPLIT_EDGE_MARGIN,
): boolean {
  return cut <= start + margin || cut >= end - margin;
}

/** True when two neighbouring clips were split from the same source window. */
export function canJoinSourceWindows(
  leftEndSeconds: number,
  rightStartSeconds: number,
  epsilon = JOIN_EPSILON,
): boolean {
  return Math.abs(leftEndSeconds - rightStartSeconds) <= epsilon;
}

export interface TrimPatch {
  source_start_seconds?: number;
  source_end_seconds?: number;
}

/** Clamp a trim so clips never overlap neighbours (gaps may be eaten, not skipped over). */
export function clampRippleTrim(
  segments: ReelSegment[],
  id: string,
  patch: TrimPatch,
  minDuration = MIN_DURATION,
): { source_start_seconds: number; source_end_seconds: number } | null {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const current = ordered[index];
  let start = patch.source_start_seconds ?? current.source_start_seconds;
  let end = patch.source_end_seconds ?? current.source_end_seconds;
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  if (previous) start = Math.max(start, previous.source_end_seconds);
  if (next) end = Math.min(end, next.source_start_seconds);
  start = Math.max(0, start);
  if (end - start < minDuration) return null;
  return { source_start_seconds: start, source_end_seconds: end };
}
