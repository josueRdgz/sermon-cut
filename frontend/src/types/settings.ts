export interface ToolInfo {
  available: boolean;
  version: string | null;
}

export interface AppSettings {
  whisper_model: string;
  whisper_models: string[];
  ai_provider: string;
  ai_providers: string[];
  gemini_model: string;
  gemini_configured: boolean;
  gemini_api_key_masked: string | null;
  ffmpeg: ToolInfo;
  ffprobe: ToolInfo;
  whisper: ToolInfo;
  gemini: ToolInfo;
}

export interface AppSettingsUpdate {
  gemini_api_key?: string | null;
  gemini_model?: string | null;
  ai_provider?: string | null;
  whisper_model?: string | null;
  clear_gemini_api_key?: boolean;
}
