export type FramingMode = 'auto_track' | 'center_crop' | 'blurred_background' | 'manual';

export interface FramingStatus {
  reel_id: string;
  framing_mode: FramingMode;
  has_cache: boolean;
  cache_segments: number;
  mediapipe: Record<string, unknown>;
  cleared: boolean;
}

export interface TrackingSegmentResult {
  segment_id: number;
  segment_uuid: string;
  stability: number;
  unstable: boolean;
  mode: FramingMode;
  sample_count: number;
  keyframe_count: number;
}

export interface TrackingReport {
  reel_id: string;
  tracker: string;
  cached: boolean;
  segments: TrackingSegmentResult[];
  mediapipe: Record<string, unknown>;
  summary: string;
}

export interface FramingPreview {
  segment_uuid: string;
  source_time: number;
  mode: FramingMode;
  crop_x: number;
  crop_y: number;
  canvas_width: number;
  canvas_height: number;
  norm_x: number;
  norm_y: number;
  norm_w: number;
  norm_h: number;
  preview_filename: string | null;
  unstable: boolean;
}

export interface ManualCropPayload {
  x: number;
  y: number;
  zoom?: number;
}
