import { describe, expect, it } from 'vitest';

import {
  highlightAssembledDuration,
  highlightPreviewIdentity,
  resolveHighlightPreviewSeek,
} from './highlightPreview';

const CLIPS = [
  { start: 10, end: 40 },
  { start: 80, end: 95 },
  { start: 200, end: 230 },
];

describe('highlight assembled preview', () => {
  it('sums only clip durations', () => {
    expect(highlightAssembledDuration(CLIPS)).toBe(75);
  });

  it('maps assembled time onto source clips', () => {
    expect(resolveHighlightPreviewSeek(CLIPS, 0)).toEqual({
      outputTime: 0,
      segmentIndex: 0,
      sourceTime: 10,
    });
    expect(resolveHighlightPreviewSeek(CLIPS, 30)).toEqual({
      outputTime: 30,
      segmentIndex: 1,
      sourceTime: 80,
    });
    expect(resolveHighlightPreviewSeek(CLIPS, 40)).toEqual({
      outputTime: 40,
      segmentIndex: 1,
      sourceTime: 90,
    });
    expect(resolveHighlightPreviewSeek(CLIPS, 75)).toMatchObject({
      segmentIndex: 2,
      sourceTime: 230,
    });
  });

  it('changes identity when clips are reordered or resized', () => {
    const original = highlightPreviewIdentity(CLIPS);
    expect(highlightPreviewIdentity([...CLIPS].reverse())).not.toBe(original);
    expect(highlightPreviewIdentity([{ start: 10, end: 41 }, CLIPS[1], CLIPS[2]])).not.toBe(
      original,
    );
  });
});
