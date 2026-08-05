import type { AudioRepairJob, AudioRepairStartPayload } from '../types/audioRepair';
import { API_BASE_URL, apiGet, apiJson } from './client';

export function startAudioRepair(
  projectId: string,
  payload: AudioRepairStartPayload,
): Promise<AudioRepairJob> {
  return apiJson<AudioRepairJob>(`/api/projects/${projectId}/audio-repair`, 'POST', payload);
}

export function getLatestAudioRepair(projectId: string): Promise<AudioRepairJob> {
  return apiGet<AudioRepairJob>(`/api/projects/${projectId}/audio-repair`);
}

export function getAudioRepairJob(jobId: string): Promise<AudioRepairJob> {
  return apiGet<AudioRepairJob>(`/api/audio-repair-jobs/${jobId}`);
}

export function cancelAudioRepair(jobId: string): Promise<AudioRepairJob> {
  return apiJson<AudioRepairJob>(`/api/audio-repair-jobs/${jobId}/cancel`, 'POST', {});
}

export function repairedAudioUrl(jobId: string): string {
  return `${API_BASE_URL}/api/audio-repair-jobs/${jobId}/audio`;
}

export function repairedVideoUrl(jobId: string, download = false): string {
  return `${API_BASE_URL}/api/audio-repair-jobs/${jobId}/video${download ? '?download=true' : ''}`;
}
