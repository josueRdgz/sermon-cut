export type AudioRepairStatus =
  'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';

export interface AudioRepairIssue {
  start_seconds: number;
  end_seconds: number;
  duration_ms: number;
  confidence: number;
  repairable: boolean;
  repaired: boolean;
  kind: string;
}

export interface AudioRepairJob {
  id: string;
  project_id: string;
  status: AudioRepairStatus;
  stage: string | null;
  progress: number;
  silence_threshold: number;
  min_dropout_ms: number;
  max_auto_repair_ms: number;
  max_review_ms: number;
  issue_count: number;
  repaired_count: number;
  review_count: number;
  issues: AudioRepairIssue[];
  has_repaired_audio: boolean;
  has_repaired_video: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AudioRepairStartPayload {
  silence_threshold: number;
  min_dropout_ms: number;
  max_auto_repair_ms: number;
  max_review_ms: number;
}
