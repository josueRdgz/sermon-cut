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

export function applyAudioRepair(jobId: string): Promise<AudioRepairJob> {
  return apiJson<AudioRepairJob>(`/api/audio-repair-jobs/${jobId}/apply`, 'POST', {});
}

export function repairedAudioUrl(jobId: string, download = false): string {
  return `${API_BASE_URL}/api/audio-repair-jobs/${jobId}/audio${download ? '?download=true' : ''}`;
}

export function originalAudioUrl(jobId: string, download = false): string {
  return `${API_BASE_URL}/api/audio-repair-jobs/${jobId}/original-audio${download ? '?download=true' : ''}`;
}

export function repairedVideoUrl(jobId: string, download = false): string {
  return `${API_BASE_URL}/api/audio-repair-jobs/${jobId}/video${download ? '?download=true' : ''}`;
}

/** Trigger a file download that works inside the Tauri webview (no `<a download>`). */
export async function downloadRepairFile(url: string, filename: string): Promise<void> {
  // Large remuxed videos must stream via the browser/OS downloader — never blob.
  const lower = filename.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.mkv') || lower.endsWith('.webm')) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.target = '_blank';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo descargar (${response.status})`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
