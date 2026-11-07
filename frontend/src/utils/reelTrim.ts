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

export interface SourceWindow {
  start: number;
  end: number;
}

export type ClipDeleteAction = 'join' | 'remove' | 'keep';

/**
 * Clips that still belong to the analysis fragment this Reel was opened from.
 * Extra fragments added later are left out so they can be deleted and re-added.
 */
export function protectedChosenSegmentIds(
  segments: ReelSegment[],
  originWindows: SourceWindow[],
  epsilon = JOIN_EPSILON,
): Set<string> {
  const remaining = originWindows
    .map((window) => ({ start: window.start, end: window.end }))
    .filter((window) => window.end - window.start > epsilon);
  const protectedIds = new Set<string>();
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  for (const clip of ordered) {
    const matchIndex = remaining.findIndex(
      (window) =>
        clip.source_start_seconds >= window.start - epsilon &&
        clip.source_end_seconds <= window.end + epsilon,
    );
    if (matchIndex < 0) continue;
    protectedIds.add(clip.id);
    const window = remaining[matchIndex];
    const fromStart = Math.abs(clip.source_start_seconds - window.start) <= epsilon;
    const toEnd = Math.abs(clip.source_end_seconds - window.end) <= epsilon;
    if (fromStart && toEnd) {
      remaining.splice(matchIndex, 1);
    } else if (fromStart) {
      window.start = clip.source_end_seconds;
      if (window.end - window.start <= epsilon) remaining.splice(matchIndex, 1);
    } else if (toEnd) {
      window.end = clip.source_start_seconds;
      if (window.end - window.start <= epsilon) remaining.splice(matchIndex, 1);
    } else {
      remaining.splice(
        matchIndex,
        1,
        { start: window.start, end: clip.source_start_seconds },
        { start: clip.source_end_seconds, end: window.end },
      );
    }
  }
  return protectedIds;
}

/**
 * User splits join back together; added clips can be removed;
 * the chosen analysis fragment cannot be deleted.
 */
export function clipDeleteAction(
  segments: ReelSegment[],
  id: string,
  originWindows: SourceWindow[],
): ClipDeleteAction {
  if (joinPartnerId(segments, id)) return 'join';
  if (protectedChosenSegmentIds(segments, originWindows).has(id)) return 'keep';
  return 'remove';
}

/**
 * Id of the left clip to join when `id` is a user-made split.
 * Analysis-added fragments (source gap) cannot be joined or deleted as a cut.
 */
export function joinPartnerId(segments: ReelSegment[], id: string): string | null {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const current = ordered[index];
  const next = ordered[index + 1];
  if (next && canJoinSourceWindows(current.source_end_seconds, next.source_start_seconds)) {
    return current.id;
  }
  const previous = ordered[index - 1];
  if (
    previous &&
    canJoinSourceWindows(previous.source_end_seconds, current.source_start_seconds)
  ) {
    return previous.id;
  }
  return null;
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
