export type ProjectStatus =
  | 'created'
  | 'importing'
  | 'ready'
  | 'transcribing'
  | 'analyzing'
  | 'editing'
  | 'rendering'
  | 'completed'
  | 'failed';

export interface Project {
  id: string;
  title: string;
  preacher_name: string | null;
  bible_reference: string | null;
  church_name: string;
  youtube_channel: string;
  full_sermon_url: string | null;
  content_mode: 'shorts' | 'highlights' | 'both';
  video_filename: string | null;
  cover_filename: string | null;
  has_video: boolean;
  has_cover: boolean;
  created_at: string;
  updated_at: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  resolution: string | null;
  status: ProjectStatus;
  error_message: string | null;
}

export interface ProjectListResponse {
  items: Project[];
  total: number;
}

export interface ProjectCreatePayload {
  title: string;
  preacher_name?: string | null;
  bible_reference?: string | null;
  church_name: string;
  youtube_channel: string;
  full_sermon_url?: string | null;
  content_mode?: 'shorts' | 'highlights' | 'both';
}

export interface ApiErrorBody {
  detail: string;
  code?: string;
}
