import { describe, expect, it } from 'vitest';

import { formatApiErrorDetail } from './errorDetail';

describe('formatApiErrorDetail', () => {
  it('keeps a plain string', () => {
    expect(formatApiErrorDetail('No se pudo guardar', 'Error')).toBe('No se pudo guardar');
  });

  it('joins FastAPI validation objects instead of [object Object]', () => {
    expect(
      formatApiErrorDetail(
        [{ loc: ['body', 'scale'], msg: 'Input should be less than or equal to 2', type: 'less_than_equal' }],
        'Error',
      ),
    ).toBe('Input should be less than or equal to 2');
  });
});
