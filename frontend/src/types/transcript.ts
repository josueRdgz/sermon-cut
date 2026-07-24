export type TranscriptSource =
  | 'uploaded_srt'
  | 'uploaded_vtt'
  | 'uploaded_json'
  | 'uploaded_txt'
  | 'whisper'
  | 'youtube'
  | 'manual';

export type TranscriptStatus = 'ready' | 'unsynced' | 'failed';

export interface TranscriptWord {
  id: string;
  order: number;
  start_seconds: number | null;
  end_seconds: number | null;
  text: string;
  confidence: number | null;
}

export interface TranscriptSegment {
  id: string;
  order: number;
  start_seconds: number | null;
  end_seconds: number | null;
  text: string;
  words: TranscriptWord[];
}

export interface Transcript {
  id: string;
  project_id: string;
  source: TranscriptSource;
  language: string | null;
  status: TranscriptStatus;
  full_text: string;
  has_word_timestamps: boolean;
  created_at: string;
  updated_at: string;
  segments: TranscriptSegment[];
}

export interface TranscriptSegmentUpdatePayload {
  text?: string;
  start_seconds?: number | null;
  end_seconds?: number | null;
}
