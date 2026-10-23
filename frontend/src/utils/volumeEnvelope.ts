export interface VolumeKeyframe {
  t_ms: number;
  gain: number;
}

export function normalizeKeyframes(points?: VolumeKeyframe[] | null): VolumeKeyframe[] {
  if (!points || points.length === 0) return [{ t_ms: 0, gain: 1 }];
  return [...points]
    .map((point) => ({
      t_ms: Math.max(0, point.t_ms),
      gain: Math.max(0, Math.min(1, point.gain)),
    }))
    .sort((a, b) => a.t_ms - b.t_ms);
}

/** Visible start/end handles so a flat envelope is still editable. Does not persist. */
export function seedEndpoints(
  points: VolumeKeyframe[] | null | undefined,
  durationMs: number,
): VolumeKeyframe[] {
  const ordered = normalizeKeyframes(points);
  const dur = Math.max(1, Math.round(durationMs));
  const startGain = ordered[0]?.gain ?? 1;
  const endGain = ordered[ordered.length - 1]?.gain ?? startGain;
  const next = [...ordered];
  if (!next.some((point) => point.t_ms <= 40)) {
    next.unshift({ t_ms: 0, gain: startGain });
  }
  if (!next.some((point) => point.t_ms >= dur - 40)) {
    next.push({ t_ms: dur, gain: endGain });
  }
  return next.sort((a, b) => a.t_ms - b.t_ms);
}

export function interpolateGain(points: VolumeKeyframe[] | null | undefined, tMs: number): number {
  const ordered = normalizeKeyframes(points);
  if (tMs <= ordered[0].t_ms) return ordered[0].gain;
  for (let index = 1; index < ordered.length; index += 1) {
    const prev = ordered[index - 1];
    const next = ordered[index];
    if (tMs <= next.t_ms) {
      const span = next.t_ms - prev.t_ms;
      if (span <= 0) return next.gain;
      const ratio = (tMs - prev.t_ms) / span;
      return prev.gain + (next.gain - prev.gain) * ratio;
    }
  }
  return ordered[ordered.length - 1].gain;
}

export function ensureFadeIn(
  points: VolumeKeyframe[] | null | undefined,
  fadeMs = 400,
): VolumeKeyframe[] {
  const ordered = normalizeKeyframes(points);
  if (ordered.length === 1 && ordered[0].t_ms <= 0 && Math.abs(ordered[0].gain - 1) < 0.001) {
    return [
      { t_ms: 0, gain: 0 },
      { t_ms: Math.max(80, fadeMs), gain: 1 },
    ];
  }
  return ordered;
}

export function removeKeyframe(
  points: VolumeKeyframe[] | null | undefined,
  tMs: number,
  snapMs = 80,
): VolumeKeyframe[] {
  const ordered = normalizeKeyframes(points);
  const next = ordered.filter((point) => Math.abs(point.t_ms - tMs) > snapMs);
  return next.length > 0 ? next : [{ t_ms: 0, gain: 1 }];
}

/** Scale the whole envelope so the gain at `tMs` becomes `nextGain`. */
export function scaleEnvelopeToGain(
  points: VolumeKeyframe[] | null | undefined,
  tMs: number,
  nextGain: number,
): VolumeKeyframe[] {
  const ordered = normalizeKeyframes(points);
  const target = Math.max(0, Math.min(1, nextGain));
  const current = interpolateGain(ordered, tMs);
  if (Math.abs(current - target) < 0.001) return ordered;
  if (current <= 0.001) {
    return upsertKeyframe(ordered, tMs, target);
  }
  const factor = target / current;
  return ordered.map((point) => ({
    ...point,
    gain: Math.max(0, Math.min(1, point.gain * factor)),
  }));
}

export function upsertKeyframe(
  points: VolumeKeyframe[] | null | undefined,
  tMs: number,
  gain: number,
  snapMs = 80,
): VolumeKeyframe[] {
  const ordered = normalizeKeyframes(points);
  const nextGain = Math.max(0, Math.min(1, gain));
  const match = ordered.findIndex((point) => Math.abs(point.t_ms - tMs) <= snapMs);
  if (match >= 0) {
    return ordered.map((point, index) =>
      index === match ? { ...point, gain: nextGain } : point,
    );
  }
  return [...ordered, { t_ms: Math.max(0, Math.round(tMs)), gain: nextGain }].sort(
    (a, b) => a.t_ms - b.t_ms,
  );
}

export function envelopePolyline(
  points: VolumeKeyframe[] | null | undefined,
  durationMs: number,
  samples = 64,
): string {
  const dur = Math.max(1, durationMs);
  const coords: string[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const tMs = (index / samples) * dur;
    const x = (tMs / dur) * 100;
    const y = (1 - interpolateGain(points, tMs)) * 36;
    coords.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return coords.join(' ');
}

export function peaksPath(peaks: number[], width: number, height: number): string {
  if (peaks.length === 0 || width <= 0 || height <= 0) return '';
  const mid = height / 2;
  const step = width / Math.max(1, peaks.length - 1);
  const top = peaks.map((peak, index) => {
    const x = index * step;
    const y = mid - peak * (mid - 2);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const bottom = [...peaks].reverse().map((peak, index) => {
    const x = (peaks.length - 1 - index) * step;
    const y = mid + peak * (mid - 2);
    return `L${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `${top.join(' ')} ${bottom.join(' ')} Z`;
}

export function slicePeaks(
  peaks: number[],
  startRatio: number,
  endRatio: number,
): number[] {
  if (peaks.length === 0) return [];
  const start = Math.max(0, Math.min(peaks.length - 1, Math.floor(startRatio * peaks.length)));
  const end = Math.max(start + 1, Math.min(peaks.length, Math.ceil(endRatio * peaks.length)));
  return peaks.slice(start, end);
}
