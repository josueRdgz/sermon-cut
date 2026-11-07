import { describe, expect, it } from 'vitest';

import {
  mergeTextOverlayStyle,
  parseTextOverlayStyle,
  textDecorationCss,
} from './textOverlayStyle';

describe('parseTextOverlayStyle', () => {
  it('clamps font size to 20–400 px', () => {
    expect(parseTextOverlayStyle({ style_json: JSON.stringify({ font_size: 8 }) }).font_size).toBe(
      20,
    );
    expect(parseTextOverlayStyle({ style_json: JSON.stringify({ font_size: 500 }) }).font_size).toBe(
      400,
    );
  });

  it('reads font and decorations from style_json', () => {
    expect(
      parseTextOverlayStyle({
        style_json: JSON.stringify({
          font_family: 'Georgia',
          font_size: 40,
          bold: true,
          underline: true,
        }),
      }),
    ).toEqual({
      font_family: 'Georgia',
      font_size: 40,
      bold: true,
      italic: false,
      underline: true,
      strikethrough: false,
    });
  });
});

describe('mergeTextOverlayStyle', () => {
  it('keeps source windows when updating the typeface', () => {
    const merged = mergeTextOverlayStyle(
      {
        style_json: JSON.stringify({
          source_start_seconds: 2,
          font_family: 'Arial',
        }),
      },
      { font_family: 'Verdana' },
    );
    const parsed = JSON.parse(merged) as Record<string, unknown>;
    expect(parsed.source_start_seconds).toBe(2);
    expect(parsed.font_family).toBe('Verdana');
  });
});

describe('textDecorationCss', () => {
  it('joins underline and strike', () => {
    expect(textDecorationCss({ underline: true, strikethrough: true })).toBe(
      'underline line-through',
    );
  });
});
