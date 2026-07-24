export type ExportPlatform =
  | 'youtube_shorts'
  | 'facebook_reels'
  | 'instagram_reels'
  | 'whatsapp_status'
  | 'custom';

export type ExportQuality = 'draft' | 'standard' | 'high';
export type FpsMode = 'original' | 'fixed_30';

export interface ExportProfile {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  platform: ExportPlatform;
  width: number;
  height: number;
  aspect_ratio: string;
  video_codec: string;
  audio_codec: string;
  max_duration_seconds: number;
  fps_mode: FpsMode;
  safe_margin_x: number;
  safe_top: number;
  safe_bottom: number;
  crf_draft: number;
  crf_standard: number;
  crf_high: number;
  preset_draft: string;
  preset_standard: string;
  preset_high: string;
  audio_bitrate_draft_k: number;
  audio_bitrate_standard_k: number;
  audio_bitrate_high_k: number;
  fragmentation_enabled: boolean;
  fragment_max_seconds: number | null;
  prefer_small_file: boolean;
  is_builtin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExportProfileListResponse {
  items: ExportProfile[];
  total: number;
  qualities: ExportQuality[];
}

export interface ExportProfilePayload {
  name?: string;
  description?: string | null;
  max_duration_seconds?: number;
  fps_mode?: FpsMode;
  safe_margin_x?: number;
  safe_top?: number;
  safe_bottom?: number;
  crf_draft?: number;
  crf_standard?: number;
  crf_high?: number;
  fragmentation_enabled?: boolean;
  fragment_max_seconds?: number | null;
  prefer_small_file?: boolean;
  is_active?: boolean;
}

export interface SizeEstimate {
  duration_seconds: number;
  width: number;
  height: number;
  fps: number;
  crf: number;
  audio_bitrate_k: number;
  estimated_bytes: number;
  estimated_mb: number;
  note: string;
  fragmentation_note: string | null;
}
