import type { Reel } from '../types/reel';
import type {
  CoherenceAutoFixPayload,
  CoherenceAutoFixResponse,
  CoherenceDismissPayload,
  CoherenceExpandPayload,
  CoherenceReport,
  CoherenceValidatePayload,
} from '../types/coherence';
import { apiJson } from './client';

export function validateReelCoherence(
  projectId: string,
  reelId: string,
  payload: CoherenceValidatePayload = {},
): Promise<CoherenceReport> {
  return apiJson<CoherenceReport>(
    `/api/projects/${projectId}/reels/${reelId}/validate`,
    'POST',
    payload,
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
