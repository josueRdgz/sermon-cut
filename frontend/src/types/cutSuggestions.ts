export type CutIntensity = 'conservative' | 'balanced' | 'aggressive';

export type CutSuggestionKind =
  | 'trim_leading_silence'
  | 'trim_trailing_silence'
  | 'reduce_internal_silence'
  | 'long_pause'
  | 'filler_word'
  | 'immediate_repetition'
  | 'false_start';

export type CutSuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface CutSuggestion {
  id: string;
  kind: CutSuggestionKind;
  intensity: CutIntensity;
  status: CutSuggestionStatus;
  segment_id: number;
  segment_uuid: string;
  region_start: number;
  region_end: number;
  message: string;
  recommendation: string;
  matched_text: string | null;
  confidence: number;
  requires_review: boolean;
  new_start: number | null;
  new_end: number | null;
  split: boolean;
  keep_before_end: number | null;
  keep_after_start: number | null;
  apply_crossfade_ms: number;
  keep_margin: number;
}

export interface CutSuggestionsReport {
  intensity: CutIntensity;
  suggestions: CutSuggestion[];
  pending_count: number;
  summary: string;
  auto_applied: boolean;
}

export interface CutSuggestPayload {
  intensity?: CutIntensity;
  include_silence?: boolean;
  include_fillers?: boolean;
}

export interface CutSuggestionActionResponse {
  suggestion: CutSuggestion;
  report: CutSuggestionsReport;
  reel_id: string;
  reel: import('./reel').Reel;
  subtitles_stale: boolean;
  note: string;
}
