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
  /** Hide the program preview so the inspector uses the full workspace. */
  previewCollapsed: boolean;
}

export const DEFAULT_NLE_LAYOUT: NleLayout = {
  binPx: 200,
  inspectorPx: 360,
  timelinePx: 280,
  dualMonitors: false,
  inspectorWide: false,
  previewCollapsed: false,
};

export const BIN_MIN = 132;
export const BIN_MAX = 320;
export const PREVIEW_MIN = 120;
export const INSPECTOR_MIN = 200;
export const INSPECTOR_MAX = 1400;
export const TIMELINE_MIN = 180;
export const TIMELINE_MAX = 900;

export function measureTimelineContentPx(slot: HTMLElement): number {
  const strip = slot.querySelector('.reel-nle__strip');
  if (!(strip instanceof HTMLElement)) return TIMELINE_MAX;
  const tracks = strip.querySelector('.reel-nle__tracks');
  if (!(tracks instanceof HTMLElement)) {
    return Math.max(TIMELINE_MIN, Math.round(strip.scrollHeight || TIMELINE_MIN));
  }
  const chrome = strip.querySelector('.reel-nle__strip-chrome');
  const above = strip.querySelector('.reel-nle__add-lane--above');
  const below = strip.querySelector('.reel-nle__add-lane--below');
  const labels = strip.querySelector('.reel-nle__label-col');
  const styles = getComputedStyle(strip);
  const pad = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const chromeH = chrome instanceof HTMLElement ? chrome.getBoundingClientRect().height : 0;
  const aboveH = above instanceof HTMLElement ? above.getBoundingClientRect().height : 0;
  const belowH = below instanceof HTMLElement ? below.getBoundingClientRect().height : 0;
  const bodyH = Math.max(tracks.scrollHeight, labels instanceof HTMLElement ? labels.scrollHeight : 0);
  return Math.max(1, Math.round(pad + chromeH + aboveH + belowH + bodyH));
}

export function maxInspectorForWorkspace(workspaceWidth: number): number {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) return INSPECTOR_MAX;
  return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(workspaceWidth - PREVIEW_MIN - 6)));
}

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
    previewCollapsed: partial.previewCollapsed ?? DEFAULT_NLE_LAYOUT.previewCollapsed,
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
