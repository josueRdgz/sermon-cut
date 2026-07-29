import type { RenderJob, RenderJobListResponse, StartRenderPayload } from '../types/render';
import { API_BASE_URL, apiDelete, apiGet, apiJson } from './client';

export function startRender(
  projectId: string,
  reelId: string,
  payload: StartRenderPayload,
): Promise<RenderJob> {
  return apiJson<RenderJob>(`/api/projects/${projectId}/reels/${reelId}/render`, 'POST', payload);
}

export function getLatestRender(projectId: string, reelId: string): Promise<RenderJob> {
  return apiGet<RenderJob>(`/api/projects/${projectId}/reels/${reelId}/render`);
}

export function listRenders(projectId: string, reelId: string): Promise<RenderJobListResponse> {
  return apiGet<RenderJobListResponse>(`/api/projects/${projectId}/reels/${reelId}/renders`);
}

export function getRenderJob(jobId: string): Promise<RenderJob> {
  return apiGet<RenderJob>(`/api/render-jobs/${jobId}`);
}

export function cancelRenderJob(jobId: string): Promise<RenderJob> {
  return apiJson<RenderJob>(`/api/render-jobs/${jobId}/cancel`, 'POST', {});
}

export function deleteRenderJob(jobId: string): Promise<void> {
  return apiDelete(`/api/render-jobs/${jobId}`);
}

export function revealRenderOutput(
  jobId: string,
): Promise<{ path: string; directory: string; platform: string; method: string }> {
  return apiJson(`/api/render-jobs/${jobId}/reveal`, 'POST', {});
}

export function renderOutputUrl(jobId: string, download = false): string {
  const suffix = download ? '?download=true' : '';
  return `${API_BASE_URL}/api/render-jobs/${jobId}/output${suffix}`;
}

export function renderReportUrl(jobId: string): string {
  return `${API_BASE_URL}/api/render-jobs/${jobId}/report`;
}
