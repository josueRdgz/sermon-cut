import type {
  ExportProfile,
  ExportProfileListResponse,
  ExportProfilePayload,
  SizeEstimate,
  ExportQuality,
} from '../types/exportProfile';
import { apiGet, apiJson } from './client';

export function listExportProfiles(): Promise<ExportProfileListResponse> {
  return apiGet('/api/export-profiles');
}

export function getExportProfile(profileId: string): Promise<ExportProfile> {
  return apiGet(`/api/export-profiles/${profileId}`);
}

export function updateExportProfile(
  profileId: string,
  payload: ExportProfilePayload,
): Promise<ExportProfile> {
  return apiJson(`/api/export-profiles/${profileId}`, 'PUT', payload);
}

export function estimateExportSize(
  projectId: string,
  reelId: string,
  payload: { profile_id: string; quality: ExportQuality; crf?: number | null },
): Promise<SizeEstimate> {
  return apiJson(
    `/api/projects/${projectId}/reels/${reelId}/export-estimate`,
    'POST',
    payload,
  );
}
