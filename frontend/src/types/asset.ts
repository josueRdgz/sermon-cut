export type ProjectAssetKind = 'image' | 'audio' | 'other';

export interface ProjectAsset {
  id: string;
  project_id: string;
  kind: ProjectAssetKind;
  filename: string;
  storage_path: string;
  original_name: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
  media_url: string;
}

export interface ProjectAssetListResponse {
  items: ProjectAsset[];
  total: number;
}
