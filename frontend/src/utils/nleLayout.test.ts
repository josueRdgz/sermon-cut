import { clampNleLayout, DEFAULT_NLE_LAYOUT } from './nleLayout';

describe('nleLayout', () => {
  it('clamps panel sizes into usable bounds', () => {
    expect(clampNleLayout({ binPx: 40, inspectorPx: 900, timelinePx: 80 })).toEqual({
      binPx: 148,
      inspectorPx: 520,
      timelinePx: 220,
      dualMonitors: false,
    });
  });

  it('keeps defaults when values are missing', () => {
    expect(clampNleLayout({})).toEqual(DEFAULT_NLE_LAYOUT);
  });
});
