export interface ToolInfo {
  available: boolean;
  version: string | null;
}

export interface StorageInfo {
  bytes_used: number;
  project_count: number;
}

export interface HealthResponse {
  status: string;
  app_name: string;
  version: string;
  ffmpeg: ToolInfo;
  ffprobe: ToolInfo;
  whisper: ToolInfo;
  gemini: ToolInfo;
  storage: StorageInfo;
}
