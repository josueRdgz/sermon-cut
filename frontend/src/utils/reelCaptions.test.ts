import { describe, expect, it } from 'vitest';

import { captionIsOmitted, captionWindowForPlacement, OMITTED_CAPTION } from './reelCaptions';

describe('captionIsOmitted', () => {
  it('treats a zero-width window as removed', () => {
    expect(captionIsOmitted(OMITTED_CAPTION)).toBe(true);
    expect(captionIsOmitted({ caption_in_ms: 400, caption_out_ms: 400 })).toBe(true);
  });

  it('keeps unset or open windows visible', () => {
    expect(captionIsOmitted({})).toBe(false);
    expect(captionIsOmitted({ caption_in_ms: 0, caption_out_ms: 1200 })).toBe(false);
    expect(captionIsOmitted({ caption_in_ms: null, caption_out_ms: null })).toBe(false);
  });
});

describe('captionWindowForPlacement', () => {
  it('covers the clip on the output clock', () => {
    expect(captionWindowForPlacement(2.5, 4)).toEqual({
      caption_in_ms: 2500,
      caption_out_ms: 6500,
    });
  });
});
