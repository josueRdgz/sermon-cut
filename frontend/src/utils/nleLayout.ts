export const NLE_LAYOUT_KEY = 'sermon-cut.nle.layout.v9';
export const NLE_COMPACT_MQ = '(max-width: 1099px)';

export function isNleCompact(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(NLE_COMPACT_MQ).matches;
}

export interface NleLayout {
  binPx: number;
  inspectorPx: number;
  timelinePx: number;
  dualMonitors: boolean;
  /** DaVinci-style wide inspector column (≥42% workspace). */
  inspectorWide: boolean;
}

export const DEFAULT_NLE_LAYOUT: NleLayout = {
  binPx: 200,
  inspectorPx: 360,
  timelinePx: 280,
  dualMonitors: false,
  inspectorWide: false,
};

export const BIN_MIN = 132;
export const BIN_MAX = 320;
export const INSPECTOR_MIN = 200;
export const INSPECTOR_MAX = 480;
export const TIMELINE_MIN = 180;
export const TIMELINE_MAX = 520;

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
    inspectorWide: partial.inspectorWide ?? DEFAULT_NLE_LAYOUT.inspectorWide,
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
