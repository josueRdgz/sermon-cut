export type OccupantKind = 'segment' | 'caption' | 'overlay' | 'music';

export interface Occupant {
  id: string;
  kind: OccupantKind;
  start: number;
  end: number;
}

const EPS = 0.05;

export function occupantId(kind: OccupantKind, id: string): string {
  return `${kind}:${id}`;
}

export function rangesOverlap(a: Occupant, b: Occupant, epsilon = EPS): boolean {
  return a.start < b.end - epsilon && b.start < a.end - epsilon;
}

export function laneConflict(occupants: Occupant[], candidate: Occupant): Occupant | null {
  return (
    occupants.find((item) => item.id !== candidate.id && rangesOverlap(item, candidate)) ?? null
  );
}

export function collectLaneOccupants(input: {
  laneCount: number;
  clips: Array<{ id: string; lane: number; start: number; end: number }>;
  captions: Array<{ id: string; lane: number; start: number; end: number }>;
  overlays: Array<{ id: string; lane: number; start: number; end: number }>;
  musicLane: number | null;
  musicEnd: number;
}): Map<number, Occupant[]> {
  const map = new Map<number, Occupant[]>();
  const add = (lane: number, occupant: Occupant) => {
    const list = map.get(lane) ?? [];
    list.push(occupant);
    map.set(lane, list);
  };
  input.clips.forEach((clip) =>
    add(clip.lane, {
      id: occupantId('segment', clip.id),
      kind: 'segment',
      start: clip.start,
      end: clip.end,
    }),
  );
  input.captions.forEach((caption) =>
    add(caption.lane, {
      id: occupantId('caption', caption.id),
      kind: 'caption',
      start: caption.start,
      end: caption.end,
    }),
  );
  input.overlays.forEach((overlay) =>
    add(overlay.lane, {
      id: occupantId('overlay', overlay.id),
      kind: 'overlay',
      start: overlay.start,
      end: overlay.end,
    }),
  );
  if (input.musicLane != null && input.musicEnd > 0) {
    add(input.musicLane, {
      id: occupantId('music', 'music'),
      kind: 'music',
      start: 0,
      end: input.musicEnd,
    });
  }
  return map;
}

/** Shift a clip so it no longer overlaps others on the lane. Null if it cannot fit. */
export function snapToFit(
  occupants: Occupant[],
  candidate: Occupant,
  timelineEnd: number,
  maxPasses = 10,
): Occupant | null {
  const width = candidate.end - candidate.start;
  if (!(width > 0) || width > timelineEnd + EPS) return null;
  let next: Occupant = { ...candidate };
  const others = occupants.filter((item) => item.id !== candidate.id);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (next.start < 0) {
      next = { ...next, start: 0, end: width };
    }
    if (next.end > timelineEnd) {
      const start = Math.max(0, timelineEnd - width);
      next = { ...next, start, end: start + width };
    }
    const hit = others.find((item) => rangesOverlap(item, next));
    if (!hit) return next;

    const before = hit.start - width;
    const after = hit.end;
    const preferAfter = Math.abs(next.start - after) <= Math.abs(next.start - before);
    if (preferAfter && after + width <= timelineEnd + EPS) {
      next = { ...next, start: after, end: after + width };
    } else if (before >= -EPS) {
      const start = Math.max(0, before);
      next = { ...next, start, end: start + width };
    } else if (after + width <= timelineEnd + EPS) {
      next = { ...next, start: after, end: after + width };
    } else {
      return null;
    }
  }
  return laneConflict(others, next) ? null : next;
}

/** Lane that can hold this window without overlap. Prefers `preferred` if it is free. */
export function resolveExclusiveLane(
  byLane: Map<number, Occupant[]>,
  candidate: Occupant,
  laneCount: number,
  preferred: number,
): number | null {
  const preferredClamped = Math.max(0, Math.min(laneCount - 1, preferred));
  if (!laneConflict(byLane.get(preferredClamped) ?? [], candidate)) return preferredClamped;
  const order = Array.from({ length: laneCount }, (_, lane) => lane).filter(
    (lane) => lane !== preferredClamped,
  );
  for (const lane of order) {
    if (!laneConflict(byLane.get(lane) ?? [], candidate)) return lane;
  }
  return null;
}

const KIND_PRIORITY: Record<OccupantKind, number> = {
  segment: 0,
  music: 1,
  caption: 2,
  overlay: 3,
};

export function parseOccupantId(id: string): { kind: OccupantKind; rawId: string } | null {
  const sep = id.indexOf(':');
  if (sep <= 0) return null;
  const kind = id.slice(0, sep);
  if (kind !== 'segment' && kind !== 'caption' && kind !== 'overlay' && kind !== 'music') {
    return null;
  }
  return { kind, rawId: id.slice(sep + 1) };
}

/**
 * Reassign later items so no two occupants overlap on the same lane.
 * Videos and music keep their lane; captions and overlays move away.
 * Opens a new lane when every existing one is taken.
 */
export function settleExclusiveLanes(
  byLane: Map<number, Occupant[]>,
  laneCount: number,
  maxLanes = 14,
): { assignments: Map<string, number>; laneCount: number } {
  type Placed = Occupant & { lane: number };
  const items: Placed[] = [];
  for (const [lane, occupants] of byLane) {
    for (const occupant of occupants) items.push({ ...occupant, lane });
  }
  items.sort(
    (a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.start - b.start || a.id.localeCompare(b.id),
  );
  const placed = new Map<number, Occupant[]>();
  const assignments = new Map<string, number>();
  let lanes = laneCount;
  for (const item of items) {
    const candidate: Occupant = { id: item.id, kind: item.kind, start: item.start, end: item.end };
    let lane = item.lane;
    if (laneConflict(placed.get(lane) ?? [], candidate)) {
      const free = resolveExclusiveLane(placed, candidate, lanes, lane);
      if (free != null) {
        lane = free;
      } else if (lanes < maxLanes) {
        lane = lanes;
        lanes += 1;
      }
    }
    placed.set(lane, [...(placed.get(lane) ?? []), candidate]);
    assignments.set(item.id, lane);
  }
  return { assignments, laneCount: lanes };
}
