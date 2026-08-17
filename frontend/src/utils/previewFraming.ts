import type { FramingMode } from '../types/framing';

/** Output-frame preview: crop fills the reel; blurred layout letterboxes. */
export function previewVideoFit(
  mode: FramingMode | string | null | undefined,
): 'cover' | 'contain' {
  return mode === 'blurred_background' ? 'contain' : 'cover';
}

export function previewObjectPosition(
  x?: number | null,
  y?: number | null,
): string {
  const px = clamp01(x, 0.5);
  const py = clamp01(y, 0.45);
  return `${Math.round(px * 1000) / 10}% ${Math.round(py * 1000) / 10}%`;
}

function clamp01(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}
