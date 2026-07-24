export type TranscriptionJobStatus =
  'queued' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';

export type WhisperModelName = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

export type TranscriptionLanguage = 'auto' | 'es' | 'en';

export interface TranscriptionJob {
  id: string;
  project_id: string;
  status: TranscriptionJobStatus;
  stage: string | null;
  model_name: string;
  language_option: string;
  detected_language: string | null;
  device: string | null;
  compute_type: string | null;
  notice: string | null;
  progress: number;
  processed_seconds: number;
  total_seconds: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface StartTranscriptionPayload {
  model_name: WhisperModelName;
  language: TranscriptionLanguage;
}

export const ACTIVE_TRANSCRIPTION_STATUSES: TranscriptionJobStatus[] = [
  'queued',
  'running',
  'cancelling',
];
