import {
  buildOutputClock,
  outputTimeAtSource,
  outputTimeForSource,
  sourceWindowsContiguous,
} from './reelOutputClock';
import type { ReelSegment } from '../types/reel';

describe('reelOutputClock', () => {
  const base = (overrides: Partial<ReelSegment> & { id: string }): ReelSegment => ({
    reel_id: 'r1',
    order: 0,
    source_start_seconds: 0,
    source_end_seconds: 5,
    transcript_text: null,
    transition_type: 'hard_cut',
    transition_duration_ms: 0,
    duration_seconds: 5,
    ...overrides,
  });

  it('sums hard cuts', () => {
    const clock = buildOutputClock([
      base({ id: 'a', order: 0, duration_seconds: 5, source_end_seconds: 5 }),
      base({
        id: 'b',
        order: 1,
        source_start_seconds: 10,
        source_end_seconds: 16,
        duration_seconds: 6,
      }),
    ]);
    expect(clock.totalDuration).toBeCloseTo(11, 5);
    expect(clock.placements[1].outputStart).toBeCloseTo(5, 5);
  });

  it('shrinks total for crossfades', () => {
    const clock = buildOutputClock([
      base({
        id: 'a',
        transition_type: 'fade',
        transition_duration_ms: 500,
        duration_seconds: 5,
        source_end_seconds: 5,
      }),
      base({
        id: 'b',
        order: 1,
        source_start_seconds: 10,
        source_end_seconds: 16,
        duration_seconds: 6,
      }),
    ]);
    expect(clock.totalDuration).toBeCloseTo(10.5, 5);
  });

  it('maps source time onto the xfade-aware output clock', () => {
    const clock = buildOutputClock([
      base({
        id: 'a',
        transition_type: 'fade',
        transition_duration_ms: 500,
        duration_seconds: 5,
        source_end_seconds: 5,
      }),
      base({
        id: 'b',
        order: 1,
        source_start_seconds: 10,
        source_end_seconds: 16,
        duration_seconds: 6,
      }),
    ]);
    expect(outputTimeForSource(clock, 0, 2)).toBeCloseTo(2, 5);
    expect(outputTimeForSource(clock, 1, 10)).toBeCloseTo(4.5, 5);
  });

  it('maps a sermon timestamp to output time or null if it was cut', () => {
    const clock = buildOutputClock([
      base({ id: 'a', order: 0, duration_seconds: 5, source_end_seconds: 5 }),
      base({
        id: 'b',
        order: 1,
        source_start_seconds: 10,
        source_end_seconds: 16,
        duration_seconds: 6,
      }),
    ]);
    expect(outputTimeAtSource(clock, 2)).toBeCloseTo(2, 5);
    expect(outputTimeAtSource(clock, 12)).toBeCloseTo(7, 5);
    expect(outputTimeAtSource(clock, 7)).toBeNull();
  });

  it('detects contiguous source windows vs omitted gaps', () => {
    expect(
      sourceWindowsContiguous(
        { source_end_seconds: 5 },
        { source_start_seconds: 5.02 },
      ),
    ).toBe(true);
    expect(
      sourceWindowsContiguous(
        { source_end_seconds: 5 },
        { source_start_seconds: 10 },
      ),
    ).toBe(false);
  });
});
