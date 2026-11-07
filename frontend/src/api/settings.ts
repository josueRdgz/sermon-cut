import type { AppSettings, AppSettingsUpdate } from '../types/settings';
import { apiGet, apiJson } from './client';

export function getAppSettings(): Promise<AppSettings> {
  return apiGet<AppSettings>('/api/settings');
}

export function updateAppSettings(payload: AppSettingsUpdate): Promise<AppSettings> {
  return apiJson<AppSettings>('/api/settings', 'PUT', payload);
}
