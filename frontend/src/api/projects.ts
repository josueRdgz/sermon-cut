import type { Project, ProjectCreatePayload, ProjectListResponse } from '../types/project';
import {
  API_BASE_URL,
  LONG_FETCH_TIMEOUT_MS,
  apiDelete,
  apiDeleteJson,
  apiGet,
  apiJson,
  uploadWithProgress,
} from './client';

export function listProjects(): Promise<ProjectListResponse> {
  return apiGet<ProjectListResponse>('/api/projects');
}

export function projectCoverUrl(id: string): string {
  return `${API_BASE_URL}/api/projects/${id}/media/cover`;
}

function withCacheKey(url: string, cacheKey?: string | number | null): string {
  if (cacheKey == null || cacheKey === '') return url;
  return `${url}?t=${encodeURIComponent(String(cacheKey))}`;
}

export function projectVideoUrl(id: string, cacheKey?: string | number | null): string {
  return withCacheKey(`${API_BASE_URL}/api/projects/${id}/media/video`, cacheKey);
}

export function projectAudioUrl(id: string, cacheKey?: string | number | null): string {
  return withCacheKey(`${API_BASE_URL}/api/projects/${id}/media/audio`, cacheKey);
}

export function getProject(id: string): Promise<Project> {
  return apiGet<Project>(`/api/projects/${id}`);
}

export function createProject(payload: ProjectCreatePayload): Promise<Project> {
  return apiJson<Project>('/api/projects', 'POST', payload);
}

export function deleteProject(id: string): Promise<void> {
  return apiDelete(`/api/projects/${id}`);
}

export function deleteProjectVideo(id: string): Promise<Project> {
  return apiDeleteJson<Project>(`/api/projects/${id}/video`);
}

export function uploadProjectVideo(
  id: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<Project> {
  return uploadWithProgress<Project>(`/api/projects/${id}/video`, file, onProgress);
}

export function uploadProjectCover(
  id: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<Project> {
  return uploadWithProgress<Project>(`/api/projects/${id}/cover`, file, onProgress);
}

export function applySermonRange(
  id: string,
  startSeconds: number,
  endSeconds: number,
): Promise<Project> {
  return apiJson<Project>(
    `/api/projects/${id}/sermon-range`,
    'POST',
    { start_seconds: startSeconds, end_seconds: endSeconds },
    { timeoutMs: LONG_FETCH_TIMEOUT_MS },
  );
}
