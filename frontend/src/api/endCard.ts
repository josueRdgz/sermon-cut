import type {
  EndCardLayout,
  EndCardLayoutInfo,
  EndCardSettings,
  EndCardSettingsPayload,
} from '../types/endCard';
import { API_BASE_URL, apiDeleteJson, apiGet, apiJson, uploadWithProgress } from './client';

export function listEndCardLayouts(): Promise<{ items: EndCardLayoutInfo[] }> {
  return apiGet('/api/end-card/layouts');
}

export function getGlobalEndCardSettings(): Promise<EndCardSettings> {
  return apiGet('/api/end-card/settings');
}

export function saveGlobalEndCardSettings(
  payload: EndCardSettingsPayload,
): Promise<EndCardSettings> {
  return apiJson('/api/end-card/settings', 'PUT', payload);
}

export function getProjectEndCardSettings(projectId: string): Promise<EndCardSettings> {
  return apiGet(`/api/projects/${projectId}/end-card/settings`);
}

export function saveProjectEndCardSettings(
  projectId: string,
  payload: EndCardSettingsPayload,
): Promise<EndCardSettings> {
  return apiJson(`/api/projects/${projectId}/end-card/settings`, 'PUT', payload);
}

export function resetProjectEndCardSettings(projectId: string): Promise<EndCardSettings> {
  return apiDeleteJson(`/api/projects/${projectId}/end-card/settings`);
}

export function uploadEndCardLogo(
  projectId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<EndCardSettings> {
  return uploadWithProgress(`/api/projects/${projectId}/end-card/logo`, file, onProgress);
}

export function uploadEndCardMusic(
  projectId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<EndCardSettings> {
  return uploadWithProgress(`/api/projects/${projectId}/end-card/music`, file, onProgress);
}

/** URL of the server-rendered PNG preview. `cacheKey` busts the browser cache. */
export function endCardPreviewUrl(
  projectId: string,
  options: { aspectRatio: string; layout?: EndCardLayout; scale?: number; cacheKey?: string },
): string {
  const params = new URLSearchParams({
    aspect_ratio: options.aspectRatio,
    scale: String(options.scale ?? 0.35),
  });
  if (options.layout) params.set('layout', options.layout);
  if (options.cacheKey) params.set('v', options.cacheKey);
  return `${API_BASE_URL}/api/projects/${projectId}/end-card/preview?${params.toString()}`;
}
