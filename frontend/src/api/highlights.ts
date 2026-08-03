import type {
  EditorialStyle,
  HighlightAnalysisJob,
  HighlightPlan,
  HighlightSegment,
  SubtitleDelivery,
} from '../types/highlight';
import { API_BASE_URL, apiGet, apiJson } from './client';

export function getHighlightPlan(projectId: string): Promise<HighlightPlan> {
  return apiGet(`/api/projects/${projectId}/highlights`);
}

export function detectSermon(projectId: string): Promise<HighlightPlan> {
  return apiJson(`/api/projects/${projectId}/highlights/detect`, 'POST', {});
}

export function updateSermonRange(
  projectId: string,
  start: number,
  end: number,
): Promise<HighlightPlan> {
  return apiJson(`/api/projects/${projectId}/highlights/sermon-range`, 'PATCH', {
    start,
    end,
  });
}

export function startHighlightAnalysis(
  projectId: string,
  targetDurationSeconds: number,
  editorialStyle: EditorialStyle,
): Promise<HighlightAnalysisJob> {
  return apiJson(`/api/projects/${projectId}/highlights/analyze`, 'POST', {
    target_duration_seconds: targetDurationSeconds,
    editorial_style: editorialStyle,
  });
}

export function getHighlightAnalysisJob(jobId: string): Promise<HighlightAnalysisJob> {
  return apiGet(`/api/highlight-analysis-jobs/${jobId}`);
}

export function cancelHighlightAnalysis(jobId: string): Promise<HighlightAnalysisJob> {
  return apiJson(`/api/highlight-analysis-jobs/${jobId}/cancel`, 'POST', {});
}

export function saveHighlightReview(
  projectId: string,
  segments: HighlightSegment[],
): Promise<HighlightPlan> {
  return apiJson(`/api/projects/${projectId}/highlights/review`, 'PUT', {
    segments: segments.map((item) => ({
      start: item.start,
      end: item.end,
      transcript: item.transcript,
      reason: item.reason,
      score: item.score,
      category: item.category,
      transition_type: item.transition_type,
      transition_duration_ms: item.transition_duration_ms,
    })),
  });
}

export function saveHighlightMetadata(
  projectId: string,
  payload: {
    chosen_title?: string | null;
    description?: string | null;
    thumbnail_text?: string | null;
    hashtags?: string[];
    keywords?: string[];
  },
): Promise<HighlightPlan> {
  return apiJson(`/api/projects/${projectId}/highlights/metadata`, 'PATCH', payload);
}

export function renderHighlight(
  projectId: string,
  payload: {
    subtitle_delivery: SubtitleDelivery;
    normalize_loudness: boolean;
    quality: 'draft' | 'standard' | 'high';
  },
): Promise<{ render_job_id: string; srt_url: string | null }> {
  return apiJson(`/api/projects/${projectId}/highlights/render`, 'POST', payload);
}

export function highlightSrtUrl(projectId: string): string {
  return `${API_BASE_URL}/api/projects/${projectId}/highlights/subtitles.srt`;
}
