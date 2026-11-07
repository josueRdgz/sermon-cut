import type { TransitionType } from '../../types/reel';
import { DEFAULT_TRANSITION_MS } from '../../utils/reelOutputClock';

export const TRANSITION_MIME = 'application/x-sermon-transition';
export const TRANSITION_DURATION_MIME = 'application/x-sermon-transition-ms';
export const MIN_TRANSITION_MS = 120;
export const MAX_TRANSITION_MS = 2000;
export const TRANSITION_DURATION_PRESETS_MS = [200, 350, 500, 800, 1000, 1500] as const;

export const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'hard_cut', label: 'Corte' },
  { value: 'short_crossfade', label: 'Fundido' },
  { value: 'fade', label: 'Difuminado' },
  { value: 'dip_to_black', label: 'A negro' },
  { value: 'flash', label: 'Destello' },
  { value: 'light_change', label: 'Luz' },
  { value: 'dissolve', label: 'Disolver' },
  { value: 'wipe_left', label: 'Borrado ←' },
  { value: 'wipe_right', label: 'Borrado →' },
  { value: 'wipe_up', label: 'Borrado ↑' },
  { value: 'wipe_down', label: 'Borrado ↓' },
  { value: 'slide_left', label: 'Deslizar ←' },
  { value: 'slide_right', label: 'Deslizar →' },
  { value: 'slide_up', label: 'Deslizar ↑' },
  { value: 'slide_down', label: 'Deslizar ↓' },
  { value: 'circle_open', label: 'Círculo' },
  { value: 'circle_close', label: 'Cerrar' },
  { value: 'pixelize', label: 'Pixelar' },
  { value: 'radial', label: 'Radial' },
  { value: 'zoom_in', label: 'Zoom' },
];

export const TRAY_TRANSITION_OPTIONS = TRANSITION_OPTIONS.filter(
  (option) => option.value !== 'hard_cut',
);

export const ADJUST_STEPS = [-1, -0.1, 0.1, 1] as const;

export function sourceGapSeconds(prevEnd: number, nextStart: number): number {
  return nextStart - prevEnd;
}

export function clampTransitionMs(value: number, fallback = DEFAULT_TRANSITION_MS): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(MIN_TRANSITION_MS, Math.min(MAX_TRANSITION_MS, Math.round(value)));
}

export function formatTransitionSeconds(ms: number): string {
  return `${(clampTransitionMs(ms) / 1000).toFixed(2).replace('.', ',')} s`;
}
