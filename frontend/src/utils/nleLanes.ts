const STORAGE_PREFIX = 'sermon-cut.nle.lanes.v2.';
const LEGACY_PREFIX = 'sermon-cut.nle.lanes.v1.';

export const DEFAULT_LANE_COUNT = 3;
export const MIN_LANES = 2;
export const MAX_LANES = 14;
/** @deprecated Use DEFAULT_LANE_COUNT. Kept so older imports keep compiling. */
export const DEFAULT_EXTRA_LANES = DEFAULT_LANE_COUNT;
export const MAX_EXTRA_LANES = MAX_LANES;

export interface NleLaneLayout {
  laneCount: number;
  videoLane: number;
  segmentLanes: Record<string, number>;
  captionLanes: Record<string, number>;
  musicLane: number;
  /** @deprecated Mapped onto laneCount - 1 when loading v1. */
  extraCount?: number;
}

export function defaultLaneLayout(): NleLaneLayout {
  return {
    laneCount: DEFAULT_LANE_COUNT,
    videoLane: 1,
    segmentLanes: {},
    captionLanes: {},
    musicLane: 0,
  };
}

export function clampLane(lane: number, laneCount: number): number {
  return Math.max(0, Math.min(Math.max(0, laneCount - 1), Math.round(lane)));
}

function migrateV1(parsed: Partial<NleLaneLayout> & { extraCount?: number }): NleLaneLayout {
  const extraCount = Math.max(1, Math.min(MAX_LANES - 1, Number(parsed.extraCount) || 2));
  const laneCount = Math.min(MAX_LANES, extraCount + 1);
  const bump = (lane: number) => lane + 1;
  const captionLanes = parsed.captionLanes && typeof parsed.captionLanes === 'object'
    ? Object.fromEntries(Object.entries(parsed.captionLanes).map(([id, lane]) => [id, bump(Number(lane) || 0)]))
    : {};
  return {
    laneCount,
    videoLane: 0,
    segmentLanes: {},
    captionLanes,
    musicLane: clampLane(bump(Number(parsed.musicLane) || 0), laneCount),
  };
}

function normalize(parsed: Partial<NleLaneLayout>): NleLaneLayout {
  const laneCount = Math.max(
    MIN_LANES,
    Math.min(MAX_LANES, Number(parsed.laneCount) || Number(parsed.extraCount) + 1 || DEFAULT_LANE_COUNT),
  );
  return {
    laneCount,
    videoLane: clampLane(Number(parsed.videoLane) || 1, laneCount),
    segmentLanes:
      parsed.segmentLanes && typeof parsed.segmentLanes === 'object' ? parsed.segmentLanes : {},
    captionLanes:
      parsed.captionLanes && typeof parsed.captionLanes === 'object' ? parsed.captionLanes : {},
    musicLane: clampLane(Number(parsed.musicLane) || laneCount - 1, laneCount),
  };
}

export function loadLaneLayout(reelId: string): NleLaneLayout {
  if (!reelId || typeof localStorage === 'undefined') return defaultLaneLayout();
  try {
    const rawV2 = localStorage.getItem(`${STORAGE_PREFIX}${reelId}`);
    if (rawV2) return normalize(JSON.parse(rawV2) as Partial<NleLaneLayout>);
    const rawV1 = localStorage.getItem(`${LEGACY_PREFIX}${reelId}`);
    if (rawV1) {
      const migrated = migrateV1(JSON.parse(rawV1) as Partial<NleLaneLayout>);
      saveLaneLayout(reelId, migrated);
      return migrated;
    }
    return defaultLaneLayout();
  } catch {
    return defaultLaneLayout();
  }
}

export function saveLaneLayout(reelId: string, layout: NleLaneLayout): void {
  if (!reelId || typeof localStorage === 'undefined') return;
  const { extraCount: _ignored, ...rest } = layout;
  localStorage.setItem(`${STORAGE_PREFIX}${reelId}`, JSON.stringify(rest));
}

export function laneForCaption(layout: NleLaneLayout, segmentId: string): number {
  const assigned = layout.captionLanes[segmentId];
  if (typeof assigned === 'number') return clampLane(assigned, layout.laneCount);
  return clampLane(layout.videoLane + 1, layout.laneCount);
}

export function laneForSegment(layout: NleLaneLayout, segmentId: string): number {
  const assigned = layout.segmentLanes[segmentId];
  if (typeof assigned === 'number') return clampLane(assigned, layout.laneCount);
  return clampLane(layout.videoLane, layout.laneCount);
}

export function insertLane(layout: NleLaneLayout, atIndex: number): NleLaneLayout {
  if (layout.laneCount >= MAX_LANES) return layout;
  const at = Math.max(0, Math.min(layout.laneCount, Math.round(atIndex)));
  const bump = (lane: number) => (lane >= at ? lane + 1 : lane);
  const bumpMap = (map: Record<string, number>) =>
    Object.fromEntries(Object.entries(map).map(([id, lane]) => [id, bump(lane)]));
  return {
    laneCount: layout.laneCount + 1,
    videoLane: bump(layout.videoLane),
    segmentLanes: bumpMap(layout.segmentLanes),
    captionLanes: bumpMap(layout.captionLanes),
    musicLane: bump(layout.musicLane),
  };
}

/** After dropping `removedIndex`, map a lane onto the remaining tracks. */
export function remapAfterRemove(lane: number, removedIndex: number): number {
  const parked = lane === removedIndex ? (removedIndex === 0 ? 1 : removedIndex - 1) : lane;
  return parked > removedIndex ? parked - 1 : parked;
}

export function removeLane(layout: NleLaneLayout, atIndex: number): NleLaneLayout {
  if (layout.laneCount <= MIN_LANES) return layout;
  const at = clampLane(atIndex, layout.laneCount);
  const remap = (lane: number) => remapAfterRemove(lane, at);
  const remapMap = (map: Record<string, number>) =>
    Object.fromEntries(Object.entries(map).map(([id, lane]) => [id, remap(lane)]));
  return {
    laneCount: layout.laneCount - 1,
    videoLane: remap(layout.videoLane),
    segmentLanes: remapMap(layout.segmentLanes),
    captionLanes: remapMap(layout.captionLanes),
    musicLane: remap(layout.musicLane),
  };
}

export function assignLanes(
  layout: NleLaneLayout,
  ids: string[],
  lane: number,
  field: 'segmentLanes' | 'captionLanes',
): NleLaneLayout {
  const next = { ...layout[field] };
  const clamped = clampLane(lane, layout.laneCount);
  ids.forEach((id) => {
    next[id] = clamped;
  });
  return { ...layout, [field]: next };
}
