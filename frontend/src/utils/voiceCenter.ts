/** Mix a right-channel voice toward the stereo center (preview + FFmpeg). */

export const DEFAULT_VOICE_CENTER = 0.35;

export function clampVoiceCenter(amount: number | null | undefined): number {
  if (amount == null || !Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(1, amount));
}

export function voiceCenterGains(amount: number | null | undefined): {
  keepLeft: number;
  mixRightIntoLeft: number;
} {
  const g = clampVoiceCenter(amount);
  if (g <= 0) return { keepLeft: 1, mixRightIntoLeft: 0 };
  const keepLeft = 1 / (1 + g);
  return { keepLeft, mixRightIntoLeft: g * keepLeft };
}

export function mixVoiceCenterSample(
  left: number,
  right: number,
  amount: number | null | undefined,
): { left: number; right: number } {
  const { keepLeft, mixRightIntoLeft } = voiceCenterGains(amount);
  return { left: keepLeft * left + mixRightIntoLeft * right, right };
}
