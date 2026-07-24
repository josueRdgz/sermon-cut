import type { SubtitlePreview, SubtitleTemplateInfo } from '../types/subtitle';
import { apiGet } from './client';

export function listSubtitleTemplates(): Promise<{ items: SubtitleTemplateInfo[] }> {
  return apiGet('/api/subtitle-templates');
}

export function getSubtitlePreview(projectId: string, reelId: string): Promise<SubtitlePreview> {
  return apiGet(`/api/projects/${projectId}/reels/${reelId}/subtitle-preview`);
}
