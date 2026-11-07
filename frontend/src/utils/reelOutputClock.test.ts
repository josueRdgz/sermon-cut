import {
  buildOutputClock,
  clampPadBeforeMs,
  editTimeFromOutput,
  outputTimeAtSource,
  outputTimeForSource,
  outputTimeFromEdit,
  sourceWindowsContiguous,
  transitionMarkerAt,
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
    expect(clock.editDuration).toBeCloseTo(11, 5);
    expect(clock.placements[1].outputStart).toBeCloseTo(5, 5);
    expect(clock.placements[1].editStart).toBeCloseTo(5, 5);
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
    expect(clock.editDuration).toBeCloseTo(11, 5);
    expect(clock.placements[0].overlapSeconds).toBeCloseTo(0.5, 5);
    expect(clock.placements[1].outputStart).toBeCloseTo(4.5, 5);
    expect(clock.placements[1].editStart).toBeCloseTo(5, 5);
    expect(clock.placements[1].overlapSeconds).toBe(0);
  });

  it('maps output time onto the sequential edit timeline at 2× through a crossfade', () => {
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
    expect(editTimeFromOutput(clock, 4.4)).toBeCloseTo(4.4, 5);
    expect(editTimeFromOutput(clock, 4.5)).toBeCloseTo(4.5, 5);
    expect(editTimeFromOutput(clock, 4.75)).toBeCloseTo(5, 5);
    expect(editTimeFromOutput(clock, 5)).toBeCloseTo(5.5, 5);
    expect(editTimeFromOutput(clock, 5.5)).toBeCloseTo(6, 5);
    expect(outputTimeFromEdit(clock, 4.4)).toBeCloseTo(4.4, 5);
    expect(outputTimeFromEdit(clock, 5)).toBeCloseTo(4.75, 5);
    expect(outputTimeFromEdit(clock, 5.5)).toBeCloseTo(5, 5);
    expect(outputTimeFromEdit(clock, 11)).toBeCloseTo(10.5, 5);
  });

  it('places a transition band over the end of A and the start of B', () => {
    const segments = [
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
    ];
    const band = transitionMarkerAt(buildOutputClock(segments), segments)[0];
    expect(band.centerRatio).toBeCloseTo(5 / 11, 5);
    expect(band.leftRatio).toBeCloseTo(4.5 / 11, 5);
    expect(band.widthRatio).toBeCloseTo(1 / 11, 5);
    expect(band.segmentId).toBe('a');
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

  it('inserts leading black before a clip and ripples later ones', () => {
    const clock = buildOutputClock([
      base({ id: 'a', order: 0, duration_seconds: 5, source_end_seconds: 5, pad_before_ms: 2000 }),
      base({
        id: 'b',
        order: 1,
        source_start_seconds: 10,
        source_end_seconds: 16,
        duration_seconds: 6,
        pad_before_ms: 500,
      }),
    ]);
    expect(clock.placements[0].outputStart).toBeCloseTo(2, 5);
    expect(clock.placements[0].padSeconds).toBeCloseTo(2, 5);
    expect(clock.placements[1].outputStart).toBeCloseTo(7.5, 5);
    expect(clock.totalDuration).toBeCloseTo(13.5, 5);
  });

  it('clamps pad to a two-minute ceiling', () => {
    expect(clampPadBeforeMs(-40)).toBe(0);
    expect(clampPadBeforeMs(2500.4)).toBe(2500);
    expect(clampPadBeforeMs(999_999)).toBe(120_000);
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
