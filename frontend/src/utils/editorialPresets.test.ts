import { describe, expect, it } from 'vitest';

import {
  CHURCH_REELS_CONTEXT,
  EXPOSITORY_CONTEXT,
  extraEditorialInstructions,
} from './editorialPresets';

describe('extraEditorialInstructions', () => {
  it('omits the default church preset because the backend already applies house style', () => {
    expect(extraEditorialInstructions('church', CHURCH_REELS_CONTEXT)).toBeNull();
  });

  it('sends teaching or custom notes to the model', () => {
    expect(extraEditorialInstructions('teaching', EXPOSITORY_CONTEXT)).toBe(EXPOSITORY_CONTEXT);
    expect(extraEditorialInstructions('custom', 'Cierra con Romanos 8.')).toBe(
      'Cierra con Romanos 8.',
    );
  });
});
