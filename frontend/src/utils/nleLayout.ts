export const NLE_LAYOUT_KEY = 'sermon-cut.nle.layout.v4';

export interface NleLayout {
  binPx: number;
  inspectorPx: number;
  timelinePx: number;
  dualMonitors: boolean;
}

export const DEFAULT_NLE_LAYOUT: NleLayout = {
  binPx: 168,
  inspectorPx: 340,
  timelinePx: 240,
  dualMonitors: false,
};

export const BIN_MIN = 148;
export const BIN_MAX = 260;
export const INSPECTOR_MIN = 300;
export const INSPECTOR_MAX = 520;
export const TIMELINE_MIN = 220;
export const TIMELINE_MAX = 480;

export function clampNleLayout(partial: Partial<NleLayout>): NleLayout {
  return {
    binPx: clamp(partial.binPx ?? DEFAULT_NLE_LAYOUT.binPx, BIN_MIN, BIN_MAX),
    inspectorPx: clamp(
      partial.inspectorPx ?? DEFAULT_NLE_LAYOUT.inspectorPx,
      INSPECTOR_MIN,
      INSPECTOR_MAX,
    ),
    timelinePx: clamp(
      partial.timelinePx ?? DEFAULT_NLE_LAYOUT.timelinePx,
      TIMELINE_MIN,
      TIMELINE_MAX,
    ),
    dualMonitors: partial.dualMonitors ?? DEFAULT_NLE_LAYOUT.dualMonitors,
  };
}

export function loadNleLayout(): NleLayout {
  try {
    const raw = window.localStorage.getItem(NLE_LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_NLE_LAYOUT };
    return clampNleLayout(JSON.parse(raw) as Partial<NleLayout>);
  } catch {
    return { ...DEFAULT_NLE_LAYOUT };
  }
}

export function saveNleLayout(layout: NleLayout): void {
  try {
    window.localStorage.setItem(NLE_LAYOUT_KEY, JSON.stringify(clampNleLayout(layout)));
  } catch {
    /* quota / private mode */
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
