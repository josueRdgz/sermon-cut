import type { TransitionType } from '../types/reel';

export interface PreviewXfadeStyle {
  outOpacity: number;
  inOpacity: number;
  veilOpacity: number;
  veilColor: string;
  inClipPath: string;
  inTransform: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** CSS mix for live preview; names match FFmpeg xfade filters used on export. */
export function previewXfadeStyle(type: TransitionType | string, progress: number): PreviewXfadeStyle {
  const p = clamp01(progress);
  const base: PreviewXfadeStyle = {
    outOpacity: 1,
    inOpacity: 1,
    veilOpacity: 0,
    veilColor: '#000',
    inClipPath: 'inset(0)',
    inTransform: 'none',
  };
  switch (type) {
    case 'dip_to_black':
      return {
        ...base,
        outOpacity: clamp01(1 - p * 2),
        inOpacity: clamp01(p * 2 - 1),
        veilOpacity: 1 - Math.abs(p * 2 - 1),
        veilColor: '#000',
      };
    case 'flash':
      return {
        ...base,
        outOpacity: clamp01(1 - p * 2),
        inOpacity: clamp01(p * 2 - 1),
        veilOpacity: 1 - Math.abs(p * 2 - 1),
        veilColor: '#fff',
      };
    case 'light_change':
      return {
        ...base,
        outOpacity: 1 - p,
        inOpacity: p,
        veilOpacity: 1 - Math.abs(p * 2 - 1),
        veilColor: '#8a8a8a',
      };
    case 'wipe_down':
      return { ...base, inClipPath: `inset(0 0 ${((1 - p) * 100).toFixed(3)}% 0)` };
    case 'wipe_left':
      return { ...base, inClipPath: `inset(0 ${((1 - p) * 100).toFixed(3)}% 0 0)` };
    case 'slide_down':
      return { ...base, inTransform: `translateY(${((p - 1) * 100).toFixed(3)}%)` };
    case 'short_crossfade':
    case 'fade':
    case 'dissolve':
      return { ...base, outOpacity: 1 - p, inOpacity: p };
    default:
      return { ...base, outOpacity: 1 - p, inOpacity: p };
  }
}

/** Match FFmpeg acrossfade triangular curves. */
export function xfadeAudioWeights(progress: number): { out: number; in: number } {
  const p = clamp01(progress);
  return { out: 1 - p, in: p };
}
