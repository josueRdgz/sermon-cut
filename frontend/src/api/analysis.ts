import type {
  AnalysisCandidate,
  AnalysisJob,
  AnalysisProviderStatus,
  AnalysisStartPayload,
} from '../types/analysis';
import type { AspectRatio } from '../types/reel';
import { LONG_FETCH_TIMEOUT_MS, apiGet, apiJson } from './client';

export function getAnalysisProviderStatus(): Promise<AnalysisProviderStatus> {
  return apiGet('/api/analysis/provider');
}

export function startAnalysis(
  projectId: string,
  payload: AnalysisStartPayload,
): Promise<AnalysisJob> {
  return apiJson(`/api/projects/${projectId}/analysis`, 'POST', payload, {
    timeoutMs: LONG_FETCH_TIMEOUT_MS,
  });
}

export function getLatestAnalysis(projectId: string): Promise<AnalysisJob> {
  return apiGet(`/api/projects/${projectId}/analysis`, LONG_FETCH_TIMEOUT_MS);
}

export function getAnalysisJob(jobId: string): Promise<AnalysisJob> {
  return apiGet(`/api/analysis-jobs/${jobId}`, LONG_FETCH_TIMEOUT_MS);
}

export function cancelAnalysisJob(jobId: string): Promise<AnalysisJob> {
  return apiJson(`/api/analysis-jobs/${jobId}/cancel`, 'POST', {}, {
    timeoutMs: LONG_FETCH_TIMEOUT_MS,
  });
}

export function listAnalysisCandidates(
  projectId: string,
  jobId?: string,
): Promise<{ items: AnalysisCandidate[]; total: number }> {
  const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : '';
  return apiGet(`/api/projects/${projectId}/analysis/candidates${query}`);
}

export function acceptAnalysisCandidate(
  projectId: string,
  candidateId: string,
  aspectRatio: AspectRatio = '9:16',
): Promise<{ candidate: AnalysisCandidate; reel_id: string }> {
  const query = `?aspect_ratio=${encodeURIComponent(aspectRatio)}`;
  return apiJson(
    `/api/projects/${projectId}/analysis/candidates/${candidateId}/accept${query}`,
    'POST',
    {},
  );
}

export function rejectAnalysisCandidate(
  projectId: string,
  candidateId: string,
): Promise<AnalysisCandidate> {
  return apiJson(
    `/api/projects/${projectId}/analysis/candidates/${candidateId}/reject`,
    'POST',
    {},
  );
}
