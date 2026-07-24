import type {
  Reel,
  ReelCreatePayload,
  ReelFromTranscriptPayload,
  ReelListResponse,
  ReelSegmentCreatePayload,
  ReelSegmentUpdatePayload,
  ReelUpdatePayload,
} from '../types/reel';
import { apiDelete, apiDeleteJson, apiGet, apiJson } from './client';

export function listReels(projectId: string): Promise<ReelListResponse> {
  return apiGet<ReelListResponse>(`/api/projects/${projectId}/reels`);
}

export function getReel(projectId: string, reelId: string): Promise<Reel> {
  return apiGet<Reel>(`/api/projects/${projectId}/reels/${reelId}`);
}

export function createReel(projectId: string, payload: ReelCreatePayload): Promise<Reel> {
  return apiJson<Reel>(`/api/projects/${projectId}/reels`, 'POST', payload);
}

export function updateReel(
  projectId: string,
  reelId: string,
  payload: ReelUpdatePayload,
): Promise<Reel> {
  return apiJson<Reel>(`/api/projects/${projectId}/reels/${reelId}`, 'PATCH', payload);
}

export function deleteReel(projectId: string, reelId: string): Promise<void> {
  return apiDelete(`/api/projects/${projectId}/reels/${reelId}`);
}

export function createReelFromTranscript(
  projectId: string,
  payload: ReelFromTranscriptPayload,
): Promise<Reel> {
  return apiJson<Reel>(`/api/projects/${projectId}/reels/from-transcript`, 'POST', payload);
}

export function addReelSegment(
  projectId: string,
  reelId: string,
  payload: ReelSegmentCreatePayload,
): Promise<Reel> {
  return apiJson<Reel>(`/api/projects/${projectId}/reels/${reelId}/segments`, 'POST', payload);
}

export function updateReelSegment(
  projectId: string,
  reelId: string,
  segmentId: string,
  payload: ReelSegmentUpdatePayload,
): Promise<Reel> {
  return apiJson<Reel>(
    `/api/projects/${projectId}/reels/${reelId}/segments/${segmentId}`,
    'PATCH',
    payload,
  );
}

export function removeReelSegment(
  projectId: string,
  reelId: string,
  segmentId: string,
): Promise<Reel> {
  return apiDeleteJson<Reel>(`/api/projects/${projectId}/reels/${reelId}/segments/${segmentId}`);
}

export function reorderReelSegments(
  projectId: string,
  reelId: string,
  items: { id: string; order: number }[],
): Promise<Reel> {
  return apiJson<Reel>(`/api/projects/${projectId}/reels/${reelId}/segments/order`, 'PUT', {
    items,
  });
}
