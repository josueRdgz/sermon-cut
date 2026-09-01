import type {
  FramingMode,
  FramingPreview,
  FramingStatus,
  ManualCropPayload,
  TrackingReport,
} from '../types/framing';
import { API_BASE_URL, DEFAULT_FETCH_TIMEOUT_MS, LONG_FETCH_TIMEOUT_MS, apiDeleteJson, apiGet, apiJson } from './client';

export function getFramingStatus(projectId: string, reelId: string): Promise<FramingStatus> {
  return apiGet(`/api/projects/${projectId}/reels/${reelId}/framing`);
}

export function setFramingMode(
  projectId: string,
  reelId: string,
  framing_mode: FramingMode,
): Promise<FramingStatus> {
  return apiJson(`/api/projects/${projectId}/reels/${reelId}/framing`, 'PUT', { framing_mode });
}

export function computeTracking(
  projectId: string,
  reelId: string,
  payload: { tracker?: string; sample_fps?: number } = {},
): Promise<TrackingReport> {
  return apiJson(
    `/api/projects/${projectId}/reels/${reelId}/framing/track`,
    'POST',
    {
      tracker: 'opencv',
      sample_fps: 2,
      ...payload,
    },
    { timeoutMs: LONG_FETCH_TIMEOUT_MS },
  );
}

export function clearTracking(projectId: string, reelId: string): Promise<FramingStatus> {
  return apiDeleteJson(`/api/projects/${projectId}/reels/${reelId}/framing/track`);
}

export function setManualCrop(
  projectId: string,
  reelId: string,
  segmentId: string,
  payload: ManualCropPayload,
): Promise<FramingStatus> {
  return apiJson(
    `/api/projects/${projectId}/reels/${reelId}/segments/${segmentId}/manual-crop`,
    'PUT',
    payload,
  );
}

export function getFramingPreview(
  projectId: string,
  reelId: string,
  sourceTime: number,
  segmentId?: string,
  signal?: AbortSignal,
): Promise<FramingPreview> {
  const params = new URLSearchParams({ source_time: String(sourceTime) });
  if (segmentId) params.set('segment_id', segmentId);
  return apiGet(
    `/api/projects/${projectId}/reels/${reelId}/framing/preview?${params}`,
    DEFAULT_FETCH_TIMEOUT_MS,
    signal,
  );
}

export function framingPreviewImageUrl(
  projectId: string,
  reelId: string,
  filename: string,
): string {
  const params = new URLSearchParams({ filename });
  return `${API_BASE_URL}/api/projects/${projectId}/reels/${reelId}/framing/preview-image?${params}`;
}
