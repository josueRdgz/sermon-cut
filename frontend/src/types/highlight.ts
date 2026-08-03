export type HighlightJobStatus =
  'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';

export type EditorialStyle =
  'balanced' | 'doctrinal' | 'emotional' | 'evangelistic' | 'educational' | 'brief';

export type SubtitleDelivery = 'none' | 'burned' | 'srt' | 'both';

export interface StrategicTitles {
  recommended: string;
  direct: string;
  emotional: string;
  biblical: string;
  search_focused: string;
}

export interface HighlightSegment {
  id: string;
  order: number;
  start: number;
  end: number;
  duration: number;
  transcript: string;
  reason: string;
  score: number;
  category: string;
  transition_type: 'hard_cut' | 'short_crossfade' | 'dip_to_black';
  transition_duration_ms: number;
}

export interface HighlightMetadata {
  suggested_titles: StrategicTitles | null;
  chosen_title: string | null;
  description: string | null;
  thumbnail_text: string | null;
  hashtags: string[];
  keywords: string[];
}

export interface HighlightPlan {
  id: string;
  project_id: string;
  reel_id: string | null;
  sermon_start: number | null;
  sermon_end: number | null;
  sermon_confidence: number | null;
  detection_method: string | null;
  detection_notes: string | null;
  requires_manual_range: boolean;
  target_duration_seconds: number;
  editorial_style: EditorialStyle;
  subtitle_delivery: SubtitleDelivery;
  title_theme: string | null;
  biblical_references: string[];
  segments: HighlightSegment[];
  estimated_duration_seconds: number;
  metadata: HighlightMetadata | null;
  regeneration_history: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}

export interface HighlightAnalysisJob {
  id: string;
  project_id: string;
  plan_id: string;
  status: HighlightJobStatus;
  stage: string | null;
  provider: string;
  target_duration_seconds: number;
  editorial_style: EditorialStyle;
  progress: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  plan: HighlightPlan | null;
}
