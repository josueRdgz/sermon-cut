import { describe, expect, it } from 'vitest';

import { highlightPullQuote } from './highlightQuote';

describe('highlightPullQuote', () => {
  it('prefers a short application sentence over setup', () => {
    const quote = highlightPullQuote(
      'Quiero comenzar con un recuento largo del capítulo. Por eso usted hoy tiene que creer esta gracia.',
    );
    expect(quote).toContain('Por eso usted hoy');
    expect(quote).not.toContain('Quiero comenzar');
  });

  it('truncates very long lines', () => {
    const quote = highlightPullQuote('Gracia '.repeat(80), 40);
    expect(quote.endsWith('…')).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(40);
  });
});
