export type ReelOverlayKind = 'image' | 'text' | 'video';

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
  return 'Imagen';
}
