/** Stored in/out when the user removes a caption strip without turning off all subtitles. */
export const OMITTED_CAPTION = { caption_in_ms: 0, caption_out_ms: 0 } as const;

export function captionIsOmitted(segment: {
  caption_in_ms?: number | null;
  caption_out_ms?: number | null;
}): boolean {
  const inn = segment.caption_in_ms;
  const out = segment.caption_out_ms;
  return inn != null && out != null && out <= inn;
}

export function captionWindowForPlacement(startSec: number, durationSec: number) {
  const inMs = Math.max(0, Math.round(startSec * 1000));
  return {
    caption_in_ms: inMs,
    caption_out_ms: Math.max(inMs + 200, Math.round((startSec + durationSec) * 1000)),
  };
}
