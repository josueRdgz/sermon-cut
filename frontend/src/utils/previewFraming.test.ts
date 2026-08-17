import { previewObjectPosition, previewVideoFit } from './previewFraming';

describe('previewFraming', () => {
  it('fills the output frame for crop modes', () => {
    expect(previewVideoFit('center_crop')).toBe('cover');
    expect(previewVideoFit('auto_track')).toBe('cover');
    expect(previewVideoFit('manual')).toBe('cover');
  });

  it('letterboxes when the layout is blurred background', () => {
    expect(previewVideoFit('blurred_background')).toBe('contain');
  });

  it('maps crop coordinates to object-position', () => {
    expect(previewObjectPosition(0.5, 0.45)).toBe('50% 45%');
    expect(previewObjectPosition(0, 1)).toBe('0% 100%');
  });
});
