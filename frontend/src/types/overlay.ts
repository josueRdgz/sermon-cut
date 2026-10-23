export type ReelOverlayKind = 'image' | 'text' | 'video' | 'audio';

export interface ReelOverlay {
  id: string;
  reel_id: string;
  kind: ReelOverlayKind;
  asset_id: string | null;
  text: string | null;
  style_json: string | null;
  start_ms: number;
  duration_ms: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  z_index: number;
  order: number;
  created_at: string;
  updated_at: string;
  asset_media_url?: string | null;
}

export interface ReelOverlayListResponse {
  items: ReelOverlay[];
  total: number;
}

export interface ReelOverlayCreatePayload {
  kind: ReelOverlayKind;
  asset_id?: string | null;
  text?: string | null;
  style_json?: string | null;
  start_ms?: number;
  duration_ms?: number;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  z_index?: number;
}

export interface ReelOverlayUpdatePayload {
  asset_id?: string | null;
  text?: string | null;
  start_ms?: number;
  duration_ms?: number;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
  z_index?: number;
  order?: number;
}

export function overlayKindLabel(kind: ReelOverlayKind): string {
  if (kind === 'text') return 'Texto';
  if (kind === 'video') return 'B-roll';
  if (kind === 'audio') return 'Audio';
  return 'Sticker';
}

export interface OverlaySourceWindow {
  start: number;
  end: number;
}

/** Sermon-source window stored on a video overlay lifted from A-roll. */
export function overlaySourceWindow(overlay: {
  style_json?: string | null;
}): OverlaySourceWindow | null {
  if (!overlay.style_json) return null;
  try {
    const parsed = JSON.parse(overlay.style_json) as {
      source_start_seconds?: number;
      source_end_seconds?: number;
    };
    const start = Number(parsed.source_start_seconds);
    const end = Number(parsed.source_end_seconds);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return { start, end };
    }
  } catch {
    return null;
  }
  return null;
}
