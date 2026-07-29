import type {
  BackgroundMusicMeters,
  BackgroundMusicPayload,
  BackgroundMusicPresetInfo,
  BackgroundMusicSettings,
} from '../types/backgroundMusic';
import { API_BASE_URL, apiGet, apiJson, uploadWithProgress } from './client';

export function listBackgroundMusicPresets(): Promise<{
  items: BackgroundMusicPresetInfo[];
  default: string;
  rights_warning: string;
}> {
  return apiGet('/api/background-music/presets');
}

export function getBackgroundMusic(projectId: string): Promise<BackgroundMusicSettings> {
  return apiGet(`/api/projects/${projectId}/background-music`);
}

export function saveBackgroundMusic(
  projectId: string,
  payload: BackgroundMusicPayload,
): Promise<BackgroundMusicSettings> {
  return apiJson(`/api/projects/${projectId}/background-music`, 'PUT', payload);
}

export function uploadBackgroundMusic(
  projectId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<BackgroundMusicSettings> {
  return uploadWithProgress(
    `/api/projects/${projectId}/background-music/upload`,
    file,
    onProgress,
  );
}

export function getBackgroundMusicMeters(projectId: string): Promise<BackgroundMusicMeters> {
  return apiGet(`/api/projects/${projectId}/background-music/meters`);
}

export function backgroundMusicAudioUrl(projectId: string, cacheKey?: string): string {
  const suffix = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : '';
  return `${API_BASE_URL}/api/projects/${projectId}/background-music/audio${suffix}`;
}
