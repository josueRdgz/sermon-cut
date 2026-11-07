import { describe, expect, it } from 'vitest';

import { canvasHeightForAspect, previewFontSizeCqh } from './previewTypography';

describe('previewTypography', () => {
  it('usa 1920 de alto en 9:16 y 1080 en el resto', () => {
    expect(canvasHeightForAspect('9:16')).toBe(1920);
    expect(canvasHeightForAspect('16:9')).toBe(1080);
    expect(canvasHeightForAspect('1:1')).toBe(1080);
  });

  it('convierte el px de exportación a cqh del visor', () => {
    expect(previewFontSizeCqh(192, '9:16')).toBe('10cqh');
    expect(previewFontSizeCqh(54, '16:9')).toBe('5cqh');
  });
});
