export type SubtitleStyle =
  'reformed_sober' | 'modern_highlight' | 'clear_reading' | 'sermon_quote';

export type SubtitleGranularity = 'auto' | 'segment' | 'phrase' | 'word';
export type SubtitlePosition = 'bottom' | 'center' | 'top';

export interface SubtitleTemplateInfo {
  id: SubtitleStyle;
  label: string;
  description: string;
  max_lines: number;
  highlight_current_word: boolean;
  quote_style: boolean;
  default_font_size: number;
  default_max_words: number;
  default_uppercase: boolean;
  default_margin_bottom: number;
  default_granularity: SubtitleGranularity;
}

export interface SubtitleCuePreview {
  start: number;
  end: number;
  text: string;
  highlight: boolean;
  words: { text: string; start: number; end: number }[];
}

export interface SubtitlePreview {
  style: string;
  granularity_used: SubtitleGranularity;
  total_duration_seconds: number;
  cues: SubtitleCuePreview[];
  position: SubtitlePosition;
  font_size: number;
  uppercase: boolean;
  opacity: number;
  margin_bottom: number;
  max_words: number;
}
