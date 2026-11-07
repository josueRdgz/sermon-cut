import {
  clampNleLayout,
  DEFAULT_NLE_LAYOUT,
  maxInspectorForWorkspace,
  measureTimelineContentPx,
} from './nleLayout';

describe('nleLayout', () => {
  it('clamps panel sizes into usable bounds', () => {
    expect(clampNleLayout({ binPx: 40, inspectorPx: 9000, timelinePx: 80 })).toEqual({
      binPx: 132,
      inspectorPx: 1400,
      timelinePx: 180,
      dualMonitors: false,
      inspectorWide: false,
      previewCollapsed: false,
    });
  });

  it('lets the inspector grow so the preview can shrink on a wide workspace', () => {
    expect(maxInspectorForWorkspace(1400)).toBe(1274);
    expect(maxInspectorForWorkspace(400)).toBe(274);
  });

  it('keeps defaults when values are missing', () => {
    expect(clampNleLayout({})).toEqual(DEFAULT_NLE_LAYOUT);
  });

  it('caps the timeline to the tracks instead of stretching empty space', () => {
    const slot = document.createElement('div');
    slot.innerHTML = `
      <div class="reel-nle__strip" style="padding: 4px 0;">
        <div class="reel-nle__strip-chrome" style="height: 20px;"></div>
        <div class="reel-nle__board">
          <div class="reel-nle__label-col" style="height: 80px;"></div>
          <div class="reel-nle__tracks" style="height: 80px;"></div>
        </div>
        <button class="reel-nle__add-lane--below" style="height: 16px;"></button>
      </div>
    `;
    document.body.append(slot);
    const measured = measureTimelineContentPx(slot);
    slot.remove();
    expect(measured).toBeGreaterThanOrEqual(1);
    expect(measured).toBeLessThan(900);
  });
});
