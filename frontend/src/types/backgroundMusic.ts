export type BackgroundMusicPreset = 'none' | 'end_card_only' | 'very_soft_background';
export type BackgroundMusicScope = 'full_reel' | 'end_card_only';

export interface BackgroundMusicSettings {
  preset: BackgroundMusicPreset;
  scope: BackgroundMusicScope;
  music_filename: string | null;
  volume: number;
  start_seconds: number;
  end_seconds: number | null;
  fade_in_ms: number;
  fade_out_ms: number;
  ducking_enabled: boolean;
  target_lufs: number;
  true_peak_db: number;
  enabled: boolean;
  rights_warning: string;
}

export interface BackgroundMusicPayload {
  preset?: BackgroundMusicPreset;
  scope?: BackgroundMusicScope;
  volume?: number;
  start_seconds?: number;
  end_seconds?: number | null;
  fade_in_ms?: number;
  fade_out_ms?: number;
  ducking_enabled?: boolean;
  target_lufs?: number;
  true_peak_db?: number;
  clear_music?: boolean;
}

export interface BackgroundMusicPresetInfo {
  id: BackgroundMusicPreset;
  label: string;
  description: string;
}

export interface BackgroundMusicMeters {
  enabled: boolean;
  preset: BackgroundMusicPreset;
  target_lufs: number;
  true_peak_db: number;
  music_volume: number;
  music_volume_db: number;
  ducking_enabled: boolean;
  estimated_music_under_voice_db: number;
  voice_priority_note: string;
  normalize_note: string;
  rights_warning: string;
  clipping_risk: string;
}
