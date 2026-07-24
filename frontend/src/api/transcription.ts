import type { StartTranscriptionPayload, TranscriptionJob } from '../types/transcription';
import { apiGet, apiJson } from './client';

export function startTranscription(
  projectId: string,
  payload: StartTranscriptionPayload,
): Promise<TranscriptionJob> {
  return apiJson<TranscriptionJob>(`/api/projects/${projectId}/transcription`, 'POST', payload);
}

export function getLatestTranscription(projectId: string): Promise<TranscriptionJob> {
  return apiGet<TranscriptionJob>(`/api/projects/${projectId}/transcription`);
}

export function getTranscriptionJob(jobId: string): Promise<TranscriptionJob> {
  return apiGet<TranscriptionJob>(`/api/transcription-jobs/${jobId}`);
}

export function cancelTranscriptionJob(jobId: string): Promise<TranscriptionJob> {
  return apiJson<TranscriptionJob>(`/api/transcription-jobs/${jobId}/cancel`, 'POST', {});
}
