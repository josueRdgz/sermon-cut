import type { Reel } from '../types/reel';
import type {
  CoherenceAutoFixPayload,
  CoherenceAutoFixResponse,
  CoherenceDismissPayload,
  CoherenceExpandPayload,
  CoherenceReport,
  CoherenceValidatePayload,
} from '../types/coherence';
import { LONG_FETCH_TIMEOUT_MS, apiJson } from './client';

export function validateReelCoherence(
  projectId: string,
  reelId: string,
  payload: CoherenceValidatePayload = {},
  signal?: AbortSignal,
): Promise<CoherenceReport> {
  const longRunning = Boolean(payload.include_ai_review || payload.include_media_probes);
  return apiJson<CoherenceReport>(
    `/api/projects/${projectId}/reels/${reelId}/validate`,
    'POST',
    payload,
    {
      timeoutMs: longRunning ? LONG_FETCH_TIMEOUT_MS : undefined,
      signal,
    },
  );
}

export function dismissCoherenceWarning(
  projectId: string,
  reelId: string,
  payload: CoherenceDismissPayload,
): Promise<CoherenceReport> {
  return apiJson<CoherenceReport>(
    `/api/projects/${projectId}/reels/${reelId}/validate/dismiss`,
    'POST',
    payload,
  );
}

export function expandCoherenceContext(
  projectId: string,
  reelId: string,
  payload: CoherenceExpandPayload,
): Promise<Reel> {
  return apiJson<Reel>(
    `/api/projects/${projectId}/reels/${reelId}/validate/expand-context`,
    'POST',
    payload,
  );
}

export function autoFixReelCoherence(
  projectId: string,
  reelId: string,
  payload: CoherenceAutoFixPayload = {},
): Promise<CoherenceAutoFixResponse> {
  return apiJson<CoherenceAutoFixResponse>(
    `/api/projects/${projectId}/reels/${reelId}/validate/auto-fix`,
    'POST',
    payload,
  );
}
