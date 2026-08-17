import type { ProjectAsset, ProjectAssetListResponse } from '../types/asset';
import { API_BASE_URL, apiDelete, apiForm, apiGet } from './client';

export function listAssets(projectId: string): Promise<ProjectAssetListResponse> {
  return apiGet<ProjectAssetListResponse>(`/api/projects/${projectId}/assets`);
}

export function uploadAsset(projectId: string, file: File): Promise<ProjectAsset> {
  const form = new FormData();
  form.append('file', file);
  return apiForm<ProjectAsset>(`/api/projects/${projectId}/assets`, form);
}

export function deleteAsset(projectId: string, assetId: string): Promise<void> {
  return apiDelete(`/api/projects/${projectId}/assets/${assetId}`);
}

export function assetMediaSrc(mediaUrl: string): string {
  if (mediaUrl.startsWith('http')) return mediaUrl;
  return `${API_BASE_URL}${mediaUrl}`;
}
