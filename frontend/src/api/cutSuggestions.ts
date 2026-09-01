import type {
  CutSuggestPayload,
  CutSuggestionActionResponse,
  CutSuggestionsReport,
} from '../types/cutSuggestions';
import { LONG_FETCH_TIMEOUT_MS, apiGet, apiJson } from './client';

export function generateCutSuggestions(
  projectId: string,
  reelId: string,
  payload: CutSuggestPayload = {},
): Promise<CutSuggestionsReport> {
  return apiJson<CutSuggestionsReport>(
    `/api/projects/${projectId}/reels/${reelId}/cut-suggestions`,
    'POST',
    {
      intensity: 'conservative',
      include_silence: true,
      include_fillers: true,
      ...payload,
    },
    { timeoutMs: LONG_FETCH_TIMEOUT_MS },
  );
}

export function listCutSuggestions(
  projectId: string,
  reelId: string,
): Promise<CutSuggestionsReport> {
  return apiGet<CutSuggestionsReport>(
    `/api/projects/${projectId}/reels/${reelId}/cut-suggestions`,
  );
}

export function acceptCutSuggestion(
  projectId: string,
  reelId: string,
  suggestionId: string,
): Promise<CutSuggestionActionResponse> {
  return apiJson<CutSuggestionActionResponse>(
    `/api/projects/${projectId}/reels/${reelId}/cut-suggestions/${suggestionId}/accept`,
    'POST',
    {},
  );
}

export function rejectCutSuggestion(
  projectId: string,
  reelId: string,
  suggestionId: string,
): Promise<CutSuggestionActionResponse> {
  return apiJson<CutSuggestionActionResponse>(
    `/api/projects/${projectId}/reels/${reelId}/cut-suggestions/${suggestionId}/reject`,
    'POST',
    {},
  );
}
