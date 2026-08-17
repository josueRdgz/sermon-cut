import type {
  ReelOverlay,
  ReelOverlayCreatePayload,
  ReelOverlayListResponse,
  ReelOverlayUpdatePayload,
} from '../types/overlay';
import { apiDelete, apiGet, apiJson } from './client';

export function listOverlays(
  projectId: string,
  reelId: string,
): Promise<ReelOverlayListResponse> {
  return apiGet<ReelOverlayListResponse>(
    `/api/projects/${projectId}/reels/${reelId}/overlays`,
  );
}

export function createOverlay(
  projectId: string,
  reelId: string,
  payload: ReelOverlayCreatePayload,
): Promise<ReelOverlay> {
  return apiJson<ReelOverlay>(
    `/api/projects/${projectId}/reels/${reelId}/overlays`,
    'POST',
    payload,
  );
}

export function updateOverlay(
  projectId: string,
  reelId: string,
  overlayId: string,
  payload: ReelOverlayUpdatePayload,
): Promise<ReelOverlay> {
  return apiJson<ReelOverlay>(
    `/api/projects/${projectId}/reels/${reelId}/overlays/${overlayId}`,
    'PATCH',
    payload,
  );
}

export function deleteOverlay(
  projectId: string,
  reelId: string,
  overlayId: string,
): Promise<void> {
  return apiDelete(`/api/projects/${projectId}/reels/${reelId}/overlays/${overlayId}`);
}
