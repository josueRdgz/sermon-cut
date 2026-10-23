import type { TransitionType } from '../../types/reel';

export const TRANSITION_MIME = 'application/x-sermon-transition';

export const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'hard_cut', label: 'Corte duro' },
  { value: 'short_crossfade', label: 'Fundido cruzado' },
  { value: 'fade', label: 'Difuminado' },
  { value: 'dip_to_black', label: 'Fundido a negro' },
  { value: 'flash', label: 'Destello' },
  { value: 'light_change', label: 'Cambio de luz' },
  { value: 'wipe_down', label: 'Borrado vertical' },
  { value: 'wipe_left', label: 'Borrado' },
  { value: 'slide_down', label: 'De arriba abajo' },
  { value: 'dissolve', label: 'Disolver' },
];

export const TRAY_TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'hard_cut', label: 'Corte duro' },
  { value: 'fade', label: 'Difuminado' },
  { value: 'light_change', label: 'Luz' },
  { value: 'wipe_down', label: 'Borrado' },
  { value: 'slide_down', label: 'Arriba ↓' },
];

export const ADJUST_STEPS = [-1, -0.1, 0.1, 1] as const;

export function sourceGapSeconds(prevEnd: number, nextStart: number): number {
  return nextStart - prevEnd;
}
