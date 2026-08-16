import { sourceGapSeconds } from './clipConstants';

describe('clipConstants', () => {
  it('reports a positive source gap between non-contiguous cuts', () => {
    expect(sourceGapSeconds(12.4, 29.1)).toBeCloseTo(16.7);
  });

  it('reports a negative overlap when the next cut starts earlier', () => {
    expect(sourceGapSeconds(10, 8.5)).toBeCloseTo(-1.5);
  });
});
