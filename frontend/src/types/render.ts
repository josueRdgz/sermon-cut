export type RenderJobStatus =
  'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';

export type RenderLayout = 'center_crop' | 'blurred_background' | 'auto_track' | 'manual';

export interface RenderJob {
  id: string;
  project_id: string;
  reel_id: string;
  status: RenderJobStatus;
  stage: string | null;
  aspect_ratio: string;
  layout: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  progress: number;
  processed_seconds: number;
  total_seconds: number | null;
  speed: number | null;
  output_filename: string | null;
  output_size_bytes: number | null;
  profile_id: string | null;
  profile_slug: string | null;
  profile_name: string | null;
  quality: string | null;
  crf: number | null;
  encode_preset: string | null;
  audio_bitrate_k: number | null;
  sha256: string | null;
  report_filename: string | null;
  verified: boolean | null;
  expected_audio: boolean | null;
  publish_status: string | null;
  ffmpeg_command: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RenderJobListResponse {
  items: RenderJob[];
  total: number;
}

export interface StartRenderPayload {
  profile_id?: string | null;
  quality?: 'draft' | 'standard' | 'high';
  aspect_ratio?: string | null;
  layout?: RenderLayout;
  normalize_loudness?: boolean;
  crf?: number | null;
  burn_subtitles?: boolean;
  audio_offset_ms?: number;
  acknowledge_coherence?: boolean;
}

export const ACTIVE_RENDER_STATUSES: RenderJobStatus[] = ['queued', 'running', 'cancelling'];
