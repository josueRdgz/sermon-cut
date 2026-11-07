import type { AspectRatio } from '../types/reel';

export function canvasHeightForAspect(aspect: AspectRatio | null | undefined): number {
  if (aspect === '16:9' || aspect === '1:1') return 1080;
  return 1920;
}

export function previewFontSizeCqh(
  fontSize: number,
  aspect: AspectRatio | null | undefined,
): string {
  const canvasHeight = canvasHeightForAspect(aspect);
  const px = Math.max(6, fontSize);
  return `${(px / canvasHeight) * 100}cqh`;
}
