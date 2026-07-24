import type { YouTubeImportJob, YouTubePreview, YouTubeQuality } from '../types/youtube';
import { apiGet, apiJson } from './client';

export function previewYouTube(url: string): Promise<YouTubePreview> {
  return apiJson<YouTubePreview>('/api/youtube/preview', 'POST', { url });
}

export function startYouTubeImport(
  projectId: string,
  url: string,
  quality: YouTubeQuality,
): Promise<YouTubeImportJob> {
  return apiJson<YouTubeImportJob>(`/api/projects/${projectId}/youtube-import`, 'POST', {
    url,
    quality,
  });
}

export function getYouTubeImportJob(jobId: string): Promise<YouTubeImportJob> {
  return apiGet<YouTubeImportJob>(`/api/youtube-import-jobs/${jobId}`);
}

export function cancelYouTubeImport(jobId: string): Promise<YouTubeImportJob> {
  return apiJson<YouTubeImportJob>(`/api/youtube-import-jobs/${jobId}/cancel`, 'POST', {});
}
