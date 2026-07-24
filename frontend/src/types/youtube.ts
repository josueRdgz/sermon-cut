export type YouTubeQuality = '720p' | '1080p' | 'best';

export type YouTubeImportStatus =
  | 'queued'
  | 'validating'
  | 'fetching_metadata'
  | 'downloading_video'
  | 'downloading_audio'
  | 'merging'
  | 'probing'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'failed';

export interface YouTubePreview {
  video_id: string;
  title: string | null;
  channel: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  resolution_label: string | null;
  upload_date: string | null;
}

export interface YouTubeImportJob {
  id: string;
  project_id: string;
  status: YouTubeImportStatus;
  stage: string | null;
  video_id: string;
  requested_quality: string;
  title: string | null;
  channel: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  resolution_label: string | null;
  upload_date: string | null;
  selected_format: string | null;
  progress: number;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  speed_bps: number | null;
  eta_seconds: number | null;
  output_filename: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}
