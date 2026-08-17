import { useRef, useState } from 'react';

import {
  assetMediaSrc,
  deleteAsset,
  listAssets,
  uploadAsset,
} from '../api/assets';
import type { ProjectAsset } from '../types/asset';

const ASSET_MIME = 'application/x-sermon-asset';

interface MediaBinPanelProps {
  projectId: string;
  assets: ProjectAsset[];
  onAssetsChange: (assets: ProjectAsset[]) => void;
  onAddTextAtPlayhead?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function MediaBinPanel({
  projectId,
  assets,
  onAssetsChange,
  onAddTextAtPlayhead,
  collapsed: collapsedProp,
  onCollapsedChange,
}: MediaBinPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = collapsedProp ?? localCollapsed;

  function setCollapsed(next: boolean) {
    if (onCollapsedChange) onCollapsedChange(next);
    else setLocalCollapsed(next);
  }

  async function refresh() {
    const response = await listAssets(projectId);
    onAssetsChange(response.items);
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        await uploadAsset(projectId, file);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el archivo');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(assetId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteAsset(projectId, assetId);
      onAssetsChange(assets.filter((item) => item.id !== assetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={`reel-nle__bin${collapsed ? ' reel-nle__bin--collapsed' : ''}`}>
      <div className="reel-nle__bin-header">
        <button
          type="button"
          className="reel-nle__bin-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '▸' : '▾'} Media bin
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="reel-nle__bin-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              Subir imagen o video
            </button>
            {onAddTextAtPlayhead && (
              <button
                type="button"
                className="button button--secondary"
                disabled={busy}
                onClick={onAddTextAtPlayhead}
              >
                Añadir texto en playhead
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.mkv,.webm"
              multiple
              hidden
              onChange={(event) => void handleUpload(event.target.files)}
            />
          </div>

          {error && <p className="error">{error}</p>}

          <div className="reel-nle__bin-grid" aria-label="Recursos del proyecto">
            {assets.length === 0 ? (
              <p className="muted reel-nle__bin-empty">
                Sube imágenes o clips de B-roll para arrastrarlos a la línea temporal.
              </p>
            ) : (
              assets.map((asset) => (
                <div key={asset.id} className="reel-nle__bin-item">
                  <button
                    type="button"
                    className="reel-nle__bin-thumb"
                    draggable
                    title={asset.original_name ?? asset.filename}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(ASSET_MIME, asset.id);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    {asset.kind === 'video' ? (
                      <video
                        src={assetMediaSrc(asset.media_url)}
                        muted
                        playsInline
                        preload="metadata"
                        draggable={false}
                      />
                    ) : (
                      <img
                        src={assetMediaSrc(asset.media_url)}
                        alt={asset.original_name ?? asset.filename}
                        draggable={false}
                      />
                    )}
                  </button>
                  <span className="reel-nle__bin-name" title={asset.original_name ?? asset.filename}>
                    {asset.kind === 'video' ? 'B-roll · ' : ''}
                    {asset.original_name ?? asset.filename}
                  </span>
                  <button
                    type="button"
                    className="button button--inline button--danger"
                    disabled={busy}
                    aria-label={`Eliminar ${asset.original_name ?? asset.filename}`}
                    onClick={() => void handleDelete(asset.id)}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
