export type EndCardLayout = 'cover_full' | 'cover_card' | 'minimal';
export type EndCardAudioMode = 'silence' | 'continue_with_fade' | 'local_music';
export type EndCardMessagePosition = 'top' | 'center' | 'bottom';

export interface EndCardLayoutInfo {
  id: EndCardLayout;
  label: string;
  description: string;
  needs_cover: boolean;
}

export interface EndCardSettings {
  layout: EndCardLayout;
  duration_seconds: number;
  fade_in_ms: number;
  audio_fade_out_ms: number;
  audio_mode: EndCardAudioMode;
  music_filename: string | null;
  music_volume: number;
  logo_filename: string | null;
  url_text: string | null;
  show_qr: boolean;
  qr_url: string | null;
  channel_handle: string | null;
  custom_message: string | null;
  message_position: EndCardMessagePosition;
  /** False when the project inherits the global configuration. */
  is_project_override: boolean;
  /** The end card cannot be turned off. */
  is_mandatory: boolean;
  min_duration_seconds: number;
  max_duration_seconds: number;
}

export type EndCardSettingsPayload = Partial<
  Pick<
    EndCardSettings,
    | 'layout'
    | 'duration_seconds'
    | 'fade_in_ms'
    | 'audio_fade_out_ms'
    | 'audio_mode'
    | 'music_volume'
    | 'url_text'
    | 'show_qr'
    | 'qr_url'
    | 'channel_handle'
    | 'custom_message'
    | 'message_position'
  >
>;
