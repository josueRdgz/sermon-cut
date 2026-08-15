export type AspectRatio = '9:16' | '1:1' | '16:9';
export type TransitionType =
  | 'hard_cut'
  | 'short_crossfade'
  | 'dip_to_black'
  | 'fade'
  | 'flash';
export type SubtitleStyle =
  'reformed_sober' | 'modern_highlight' | 'clear_reading' | 'sermon_quote';
export type SubtitleGranularity = 'auto' | 'segment' | 'phrase' | 'word';
export type SubtitlePosition = 'bottom' | 'center' | 'top';
export type ReelStatus = 'draft' | 'ready' | 'rendering' | 'completed' | 'failed';
export type FramingMode = 'auto_track' | 'center_crop' | 'blurred_background' | 'manual';

export interface ReelSegment {
  id: string;
  reel_id: string;
  order: number;
  source_start_seconds: number;
  source_end_seconds: number;
  transcript_text: string | null;
  transition_type: TransitionType;
  transition_duration_ms: number;
  duration_seconds: number;
  manual_crop_x?: number | null;
  manual_crop_y?: number | null;
  manual_crop_zoom?: number | null;
}

export interface Reel {
  id: string;
  project_id: string;
  title: string;
  hook: string | null;
  description: string | null;
  editorial_score: number | null;
  content_kind: 'short' | 'highlight';
  subtitle_style: SubtitleStyle;
  subtitle_enabled: boolean;
  subtitle_granularity: SubtitleGranularity;
  subtitle_font_size: number;
  subtitle_position: SubtitlePosition;
  subtitle_uppercase: boolean;
  subtitle_max_words: number;
  subtitle_opacity: number;
  subtitle_margin_bottom: number;
  subtitle_bible_reference: string | null;
  aspect_ratio: AspectRatio;
  status: ReelStatus;
  framing_mode?: FramingMode | string;
  /** Positive delays audio; negative advances it. */
  audio_offset_ms: number;
  created_at: string;
  updated_at: string;
  segments: ReelSegment[];
  content_duration_seconds: number;
  total_duration_seconds: number;
  coherence_dismissals?: { code: string; segment_id: number; segment_uuid?: string | null }[];
}

export interface ReelListResponse {
  items: Reel[];
  total: number;
}

export interface ReelSegmentCreatePayload {
  source_start_seconds: number;
  source_end_seconds: number;
  transcript_text?: string | null;
  transition_type?: TransitionType;
  transition_duration_ms?: number;
  order?: number | null;
}

export interface ReelCreatePayload {
  title: string;
  hook?: string | null;
  description?: string | null;
  editorial_score?: number | null;
  subtitle_style?: SubtitleStyle;
  aspect_ratio?: AspectRatio;
  status?: ReelStatus;
  segments?: ReelSegmentCreatePayload[];
}

export interface ReelUpdatePayload {
  title?: string;
  hook?: string | null;
  description?: string | null;
  editorial_score?: number | null;
  subtitle_style?: SubtitleStyle;
  subtitle_enabled?: boolean;
  subtitle_granularity?: SubtitleGranularity;
  subtitle_font_size?: number;
  subtitle_position?: SubtitlePosition;
  subtitle_uppercase?: boolean;
  subtitle_max_words?: number;
  subtitle_opacity?: number;
  subtitle_margin_bottom?: number;
  subtitle_bible_reference?: string | null;
  aspect_ratio?: AspectRatio;
  status?: ReelStatus;
  audio_offset_ms?: number;
}

export interface ReelSegmentUpdatePayload {
  source_start_seconds?: number;
  source_end_seconds?: number;
  transcript_text?: string | null;
  transition_type?: TransitionType;
  transition_duration_ms?: number;
}

export interface ReelFromTranscriptPayload {
  title?: string;
  transcript_segment_ids: string[];
  aspect_ratio?: AspectRatio;
  reel_id?: string | null;
  transition_type?: TransitionType;
  transition_duration_ms?: number;
}
