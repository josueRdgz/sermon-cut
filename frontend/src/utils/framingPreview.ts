/** Bucket playhead times so playback does not spawn an FFmpeg still every frame. */
export function quantizeFramingPreviewTime(sourceTime: number, step = 0.25): number {
  if (!Number.isFinite(sourceTime) || sourceTime < 0) return 0;
  return Math.round(sourceTime / step) * step;
}
