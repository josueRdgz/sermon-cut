export type AnalysisJobStatus =
  'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';

export type AnalysisCandidateStatus = 'pending' | 'accepted' | 'rejected';

export const ACTIVE_ANALYSIS_STATUSES: AnalysisJobStatus[] = ['queued', 'running', 'cancelling'];

export interface AnalysisProviderStatus {
  requested: string;
  active: string;
  gemini_configured: boolean;
  gemini_sdk_installed: boolean;
  gemini_model: string;
  optional: boolean;
}

export interface AnalysisStartPayload {
  max_reels: number;
  min_duration_seconds: number;
  max_duration_seconds: number;
  additional_instructions?: string | null;
  doctrinal_orientation?: string | null;
}

export interface AnalysisCandidateSegment {
  start: number;
  end: number;
  exact_text: string;
  reason: string;
  match_ratio: number | null;
  snapped: boolean;
}

export interface AnalysisCandidate {
  id: string;
  job_id: string;
  project_id: string;
  rank: number;
  status: AnalysisCandidateStatus;
  title: string;
  hook: string | null;
  summary: string | null;
  editorial_score: number;
  confidence: number;
  joined_script: string | null;
  caption: string | null;
  hashtags: string[];
  segments: AnalysisCandidateSegment[];
  warnings: string[];
  removed_context_warning: string | null;
  accepted_reel_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisJob {
  id: string;
  project_id: string;
  status: AnalysisJobStatus;
  stage: string | null;
  provider: string;
  max_reels: number;
  min_duration_seconds: number;
  max_duration_seconds: number;
  additional_instructions: string | null;
  doctrinal_orientation: string | null;
  progress: number;
  chunk_count: number;
  chunks_completed: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  rejected_count: number;
  notice: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  candidates: AnalysisCandidate[];
}
