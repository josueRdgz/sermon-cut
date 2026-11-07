export type OccupantKind = 'segment' | 'caption' | 'overlay' | 'music' | 'text';

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
  overlays: Array<{
    id: string;
    lane: number;
    start: number;
    end: number;
    asText?: boolean;
  }>;
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
  input.overlays.forEach((overlay) => {
    const kind: OccupantKind = overlay.asText ? 'text' : 'overlay';
    add(overlay.lane, {
      id: occupantId(kind, overlay.id),
      kind,
      start: overlay.start,
      end: overlay.end,
    });
  });
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

function lastOccupantEnd(occupants: Occupant[]): number {
  return occupants.reduce((max, item) => Math.max(max, item.end), 0);
}

/** Shift a clip so it no longer overlaps others on the lane. Null if it cannot fit. */
export function snapToFit(
  occupants: Occupant[],
  candidate: Occupant,
  timelineEnd: number,
  maxPasses = 10,
): Occupant | null {
  const width = candidate.end - candidate.start;
  const bounded = Number.isFinite(timelineEnd);
  if (!(width > 0) || (bounded && width > timelineEnd + EPS)) return null;
  let next: Occupant = { ...candidate };
  const others = occupants.filter((item) => item.id !== candidate.id);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    if (next.start < 0) {
      next = { ...next, start: 0, end: width };
    }
    if (bounded && next.end > timelineEnd) {
      const start = Math.max(0, timelineEnd - width);
      next = { ...next, start, end: start + width };
    }
    const hit = others.find((item) => rangesOverlap(item, next));
    if (!hit) return next;

    const before = hit.start - width;
    const after = hit.end;
    const fitsAfter = !bounded || after + width <= timelineEnd + EPS;
    const preferAfter = Math.abs(next.start - after) <= Math.abs(next.start - before);
    if (preferAfter && fitsAfter) {
      next = { ...next, start: after, end: after + width };
    } else if (before >= -EPS && (!bounded || before + width <= timelineEnd + EPS)) {
      const start = Math.max(0, before);
      next = { ...next, start, end: start + width };
    } else if (fitsAfter) {
      next = { ...next, start: after, end: after + width };
    } else {
      return null;
    }
  }
  return laneConflict(others, next) ? null : next;
}

export function laneHasVideo(occupants: Occupant[]): boolean {
  return occupants.some((item) => item.kind === 'segment');
}

export function laneIsEmpty(occupants: Occupant[]): boolean {
  return occupants.length === 0;
}

/** Text never shares a lane with video; it prefers a completely empty line. */
export function placeTextOverlay(
  byLane: Map<number, Occupant[]>,
  candidate: Occupant,
  laneCount: number,
  preferred: number,
  maxLanes = 14,
): { occupant: Occupant; lane: number; laneCount: number } {
  const empty = (lane: number) => laneIsEmpty(byLane.get(lane) ?? []);
  const noVideo = (lane: number) => !laneHasVideo(byLane.get(lane) ?? []);
  let lanes = Math.max(1, laneCount);
  let lane = Math.max(0, Math.min(lanes - 1, preferred));
  if (!empty(lane)) {
    const foundEmpty = Array.from({ length: lanes }, (_, index) => index).find(empty);
    if (foundEmpty != null) {
      lane = foundEmpty;
    } else if (lanes < maxLanes) {
      lane = lanes;
      lanes += 1;
    } else {
      const foundFree = Array.from({ length: lanes }, (_, index) => index).find(noVideo);
      if (foundFree != null) lane = foundFree;
    }
  }
  const occupant = placeOnLane(byLane.get(lane) ?? [], candidate);
  return { occupant, lane, laneCount: lanes };
}

/**
 * Keep the clip on this lane. If it would stack, sit it flush after the last occupant.
 * Extends past the current program when needed so videos and overlays can share a line.
 */
export function placeOnLane(occupants: Occupant[], candidate: Occupant): Occupant {
  const width = Math.max(0, candidate.end - candidate.start);
  const others = occupants.filter((item) => item.id !== candidate.id);
  let next: Occupant = { ...candidate };
  if (!(width > 0)) return next;
  if (next.start < 0) {
    next = { ...next, start: 0, end: width };
  }
  if (!laneConflict(others, next)) return next;
  const fitted = snapToFit(others, next, Number.POSITIVE_INFINITY);
  if (fitted && !laneConflict(others, fitted)) return fitted;
  const start = lastOccupantEnd(others);
  return { ...next, start, end: start + width };
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
  text: 4,
};

export function parseOccupantId(id: string): { kind: OccupantKind; rawId: string } | null {
  const sep = id.indexOf(':');
  if (sep <= 0) return null;
  const kind = id.slice(0, sep);
  if (
    kind !== 'segment' &&
    kind !== 'caption' &&
    kind !== 'overlay' &&
    kind !== 'music' &&
    kind !== 'text'
  ) {
    return null;
  }
  return { kind, rawId: id.slice(sep + 1) };
}

/**
 * Pack items so nothing stacks on a lane.
 * Videos and music keep their time (and lane if free); captions and overlays
 * sit flush after whatever is already on that line.
 */
export function settleExclusiveLanes(
  byLane: Map<number, Occupant[]>,
  laneCount: number,
  maxLanes = 14,
): {
  assignments: Map<string, number>;
  laneCount: number;
  times: Map<string, { start: number; end: number }>;
} {
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
  const times = new Map<string, { start: number; end: number }>();
  let lanes = laneCount;
  for (const item of items) {
    const candidate: Occupant = { id: item.id, kind: item.kind, start: item.start, end: item.end };
    let lane = item.lane;
    let next = candidate;
    if (item.kind === 'segment' || item.kind === 'music') {
      if (laneConflict(placed.get(lane) ?? [], candidate)) {
        const free = resolveExclusiveLane(placed, candidate, lanes, lane);
        if (free != null) {
          lane = free;
        } else if (lanes < maxLanes) {
          lane = lanes;
          lanes += 1;
        }
      }
    } else if (item.kind === 'text') {
      const packed = placeTextOverlay(placed, candidate, lanes, lane, maxLanes);
      lane = packed.lane;
      lanes = packed.laneCount;
      next = packed.occupant;
    } else {
      next = placeOnLane(placed.get(lane) ?? [], candidate);
    }
    placed.set(lane, [...(placed.get(lane) ?? []), next]);
    assignments.set(item.id, lane);
    times.set(item.id, { start: next.start, end: next.end });
  }
  return { assignments, laneCount: lanes, times };
}
