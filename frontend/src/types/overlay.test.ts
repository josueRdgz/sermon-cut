import { describe, expect, it } from 'vitest';

import { clampOverlayScale, overlayKindLabel, overlayTextLabel } from './overlay';

describe('overlayTextLabel', () => {
  it('no muestra [object Object]', () => {
    expect(overlayTextLabel('[object Object]')).toBe('Texto');
    expect(overlayTextLabel({ font_size: 80 })).toBe('Texto');
    expect(overlayTextLabel('Hola')).toBe('Hola');
  });
});

describe('overlayKindLabel', () => {
  it('llama imagen a las capas de imagen', () => {
    expect(overlayKindLabel('image')).toBe('Imagen');
    expect(overlayKindLabel('text')).toBe('Texto');
    expect(overlayKindLabel('video')).toBe('B-roll');
    expect(overlayKindLabel('audio')).toBe('Audio');
  });
});

describe('clampOverlayScale', () => {
  it('permite agrandar hasta el 400 %', () => {
    expect(clampOverlayScale(0.01)).toBe(0.08);
    expect(clampOverlayScale(2)).toBe(2);
    expect(clampOverlayScale(4)).toBe(4);
    expect(clampOverlayScale(8)).toBe(4);
  });
});
