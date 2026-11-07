import { describe, expect, it } from 'vitest';

import { formatChapterText, formatSelectedVerses, formatVerseLine, versesForChapter } from '../api/bible';

describe('bible helpers', () => {
  const book = {
    id: 'JHN',
    name: 'Juan',
    chapters: [['', 'En el principio era el Verbo.', 'Este era en el principio.']],
  };

  it('salta versículos vacíos y numera desde 1', () => {
    expect(versesForChapter(book, 1)).toEqual([
      { number: 2, text: 'En el principio era el Verbo.' },
      { number: 3, text: 'Este era en el principio.' },
    ]);
  });

  it('formatea una cita lista para copiar', () => {
    expect(formatVerseLine('Juan', 3, { number: 16, text: 'Porque de tal manera amó Dios al mundo.' })).toBe(
      'Juan 3:16 Porque de tal manera amó Dios al mundo.',
    );
  });

  it('copia el capítulo con un versículo por línea', () => {
    expect(formatChapterText('Juan', 1, versesForChapter(book, 1))).toContain('Juan 1:2 En el principio era el Verbo.');
  });

  it('copia un versículo seleccionado con su cita', () => {
    expect(
      formatSelectedVerses('Juan', 3, [{ number: 16, text: 'Porque de tal manera amó Dios al mundo.' }]),
    ).toBe('Juan 3:16 Porque de tal manera amó Dios al mundo.');
  });

  it('copia un rango consecutivo con cita compacta', () => {
    expect(
      formatSelectedVerses('Juan', 3, [
        { number: 16, text: 'Primero.' },
        { number: 17, text: 'Segundo.' },
      ]),
    ).toBe('Juan 3:16-17\nPrimero.\nSegundo.');
  });

  it('copia versículos no consecutivos cada uno con su cita', () => {
    expect(
      formatSelectedVerses('Juan', 3, [
        { number: 16, text: 'Primero.' },
        { number: 18, text: 'Tercero.' },
      ]),
    ).toBe('Juan 3:16 Primero.\nJuan 3:18 Tercero.');
  });
});
