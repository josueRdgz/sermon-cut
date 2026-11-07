import type { TransitionType } from '../types/reel';

export interface PreviewXfadeStyle {
  outOpacity: number;
  inOpacity: number;
  veilOpacity: number;
  veilColor: string;
  inClipPath: string;
  outClipPath: string;
  inTransform: string;
  inFilter: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const BASE: PreviewXfadeStyle = {
  outOpacity: 1,
  inOpacity: 1,
  veilOpacity: 0,
  veilColor: '#000',
  inClipPath: 'inset(0)',
  outClipPath: 'inset(0)',
  inTransform: 'none',
  inFilter: 'none',
};

/** CSS mix for live preview; names match FFmpeg xfade filters used on export. */
export function previewXfadeStyle(type: TransitionType | string, progress: number): PreviewXfadeStyle {
  const p = clamp01(progress);
  switch (type) {
    case 'dip_to_black':
      return {
        ...BASE,
        outOpacity: clamp01(1 - p * 2),
        inOpacity: clamp01(p * 2 - 1),
        veilOpacity: 1 - Math.abs(p * 2 - 1),
        veilColor: '#000',
      };
    case 'flash':
      return {
        ...BASE,
        outOpacity: clamp01(1 - p * 2),
        inOpacity: clamp01(p * 2 - 1),
        veilOpacity: 1 - Math.abs(p * 2 - 1),
        veilColor: '#fff',
      };
    case 'light_change':
      return {
        ...BASE,
        outOpacity: 1 - p,
        inOpacity: p,
        veilOpacity: 1 - Math.abs(p * 2 - 1),
        veilColor: '#8a8a8a',
      };
    case 'wipe_down':
      return { ...BASE, inClipPath: `inset(0 0 ${((1 - p) * 100).toFixed(3)}% 0)` };
    case 'wipe_up':
      return { ...BASE, inClipPath: `inset(${((1 - p) * 100).toFixed(3)}% 0 0 0)` };
    case 'wipe_left':
      return { ...BASE, inClipPath: `inset(0 ${((1 - p) * 100).toFixed(3)}% 0 0)` };
    case 'wipe_right':
      return { ...BASE, inClipPath: `inset(0 0 0 ${((1 - p) * 100).toFixed(3)}%)` };
    case 'slide_down':
      return { ...BASE, inTransform: `translateY(${((p - 1) * 100).toFixed(3)}%)` };
    case 'slide_up':
      return { ...BASE, inTransform: `translateY(${((1 - p) * 100).toFixed(3)}%)` };
    case 'slide_left':
      return { ...BASE, inTransform: `translateX(${((1 - p) * 100).toFixed(3)}%)` };
    case 'slide_right':
      return { ...BASE, inTransform: `translateX(${((p - 1) * 100).toFixed(3)}%)` };
    case 'circle_open':
    case 'radial':
      return { ...BASE, inClipPath: `circle(${(p * 75).toFixed(2)}% at 50% 50%)` };
    case 'circle_close':
      return {
        ...BASE,
        outClipPath: `circle(${((1 - p) * 75).toFixed(2)}% at 50% 50%)`,
        inOpacity: p,
      };
    case 'pixelize': {
      const blur = (0.5 - Math.abs(p - 0.5)) * 10;
      return {
        ...BASE,
        outOpacity: 1 - p,
        inOpacity: p,
        inFilter: `blur(${blur.toFixed(2)}px) contrast(1.15)`,
      };
    }
    case 'zoom_in':
      return {
        ...BASE,
        inOpacity: p,
        inTransform: `scale(${(0.35 + p * 0.65).toFixed(3)})`,
      };
    case 'short_crossfade':
    case 'fade':
    case 'dissolve':
      return { ...BASE, outOpacity: 1 - p, inOpacity: p };
    default:
      return { ...BASE, outOpacity: 1 - p, inOpacity: p };
  }
}

/** Match FFmpeg acrossfade triangular curves. */
export function xfadeAudioWeights(progress: number): { out: number; in: number } {
  const p = clamp01(progress);
  return { out: 1 - p, in: p };
}
