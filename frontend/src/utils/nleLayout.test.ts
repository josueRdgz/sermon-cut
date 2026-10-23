import { clampNleLayout, DEFAULT_NLE_LAYOUT } from './nleLayout';

describe('nleLayout', () => {
  it('clamps panel sizes into usable bounds', () => {
    expect(clampNleLayout({ binPx: 40, inspectorPx: 900, timelinePx: 80 })).toEqual({
      binPx: 132,
      inspectorPx: 480,
      timelinePx: 180,
      dualMonitors: false,
      inspectorWide: false,
    });
  });

  it('keeps defaults when values are missing', () => {
    expect(clampNleLayout({})).toEqual(DEFAULT_NLE_LAYOUT);
  });
});
