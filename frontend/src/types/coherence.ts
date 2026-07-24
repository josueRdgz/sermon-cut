export type CoherenceSeverity = 'valid' | 'warning' | 'blocked';

export interface CoherenceIssue {
  severity: CoherenceSeverity;
  code: string;
  message: string;
  segment_id: number;
  segment_uuid: string | null;
  recommendation: string;
  dismissed: boolean;
}

export interface CoherenceReport {
  severity: CoherenceSeverity;
  issues: CoherenceIssue[];
  joined_script: string;
  ai_reviewed: boolean;
  media_probed: boolean;
  can_render: boolean;
  summary: string;
}

export interface CoherenceValidatePayload {
  include_ai_review?: boolean;
  include_media_probes?: boolean;
}

export interface CoherenceDismissPayload {
  code: string;
  segment_id: number;
}

export interface CoherenceExpandPayload {
  segment_id: number;
  before_seconds?: number;
  after_seconds?: number;
}
