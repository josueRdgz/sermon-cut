export interface ToolInfo {
  available: boolean;
  version: string | null;
}

export interface HealthResponse {
  status: string;
  app_name: string;
  ffmpeg: ToolInfo;
  ffprobe: ToolInfo;
}
