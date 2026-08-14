import type { Transcript, TranscriptSegmentUpdatePayload } from '../types/transcript';
import { API_BASE_URL, apiDelete, apiForm, apiGet, apiJson } from './client';

export function getTranscript(projectId: string): Promise<Transcript> {
  return apiGet<Transcript>(`/api/projects/${projectId}/transcript`);
}

export function uploadTranscript(
  projectId: string,
  file: File,
  language?: string,
): Promise<Transcript> {
  const form = new FormData();
  form.append('file', file);
  if (language?.trim()) {
    form.append('language', language.trim());
  }
  return apiForm<Transcript>(`/api/projects/${projectId}/transcript`, form);
}

export function updateSegment(
  segmentId: string,
  payload: TranscriptSegmentUpdatePayload,
): Promise<Transcript> {
  return apiJson<Transcript>(`/api/transcripts/segments/${segmentId}`, 'PATCH', payload);
}

export function deleteTranscript(projectId: string): Promise<void> {
  return apiDelete(`/api/projects/${projectId}/transcript`);
}

export { projectVideoUrl } from './projects';

export function transcriptExportUrl(projectId: string, format: 'srt' | 'vtt' | 'json'): string {
  return `${API_BASE_URL}/api/projects/${projectId}/transcript/export?format=${format}`;
}
