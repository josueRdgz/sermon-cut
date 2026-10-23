import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_OUTPUT_PRESETS,
  CHURCH_REELS_CONTEXT,
  MEDITATION_CONTEXT,
  YOUTH_CONTEXT,
  buildAnalysisInstructions,
  extraEditorialInstructions,
} from './editorialPresets';

describe('editorial presets', () => {
  it('keeps youth and meditation styles distinct', () => {
    expect(YOUTH_CONTEXT).toMatch(/juvenil/i);
    expect(MEDITATION_CONTEXT).toMatch(/meditación/i);
    expect(YOUTH_CONTEXT).not.toBe(MEDITATION_CONTEXT);
    expect(YOUTH_CONTEXT).not.toBe(CHURCH_REELS_CONTEXT);
  });

  it('sends the composed style text to the model', () => {
    expect(extraEditorialInstructions(YOUTH_CONTEXT)).toBe(YOUTH_CONTEXT);
    expect(extraEditorialInstructions('Cierra con Romanos 8.')).toBe(
      'Cierra con Romanos 8.',
    );
  });

  it('includes format, source and style in the analysis prompt', () => {
    const text = buildAnalysisInstructions({
      outputKind: 'highlights',
      sourceKind: 'full_service',
      styleText: MEDITATION_CONTEXT,
    });
    expect(text).toContain(ANALYSIS_OUTPUT_PRESETS.highlights.prompt);
    expect(text).toContain('culto completo');
    expect(text).toContain(MEDITATION_CONTEXT);
  });
});
