import type { TransitionType } from '../../types/reel';

export const TRANSITION_MIME = 'application/x-sermon-transition';

export const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'hard_cut', label: 'Corte duro' },
  { value: 'short_crossfade', label: 'Fundido cruzado' },
  { value: 'dip_to_black', label: 'Fundido a negro' },
  { value: 'fade', label: 'Difuminar' },
  { value: 'flash', label: 'Destello' },
];

export const ADJUST_STEPS = [-1, -0.1, 0.1, 1] as const;

export function sourceGapSeconds(prevEnd: number, nextStart: number): number {
  return nextStart - prevEnd;
}
