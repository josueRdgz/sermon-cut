import { useRef, useState } from 'react';

import {
  assetMediaSrc,
  deleteAsset,
  listAssets,
  uploadAsset,
} from '../api/assets';
import type { AnalysisCandidate } from '../types/analysis';
import type { ProjectAsset } from '../types/asset';
import { formatDuration, formatTimecode } from '../utils/format';

const ASSET_MIME = 'application/x-sermon-asset';

interface MediaBinPanelProps {
  projectId: string;
  assets: ProjectAsset[];
  onAssetsChange: (assets: ProjectAsset[]) => void;
  onAddTextAtPlayhead?: () => void;
  onAddAtPlayhead?: (assetId: string) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  analysisCandidates?: AnalysisCandidate[];
  onAddCandidate?: (candidate: AnalysisCandidate) => void;
  candidatesBusy?: boolean;
}

export function MediaBinPanel({
  projectId,
  assets,
  onAssetsChange,
  onAddTextAtPlayhead,
  onAddAtPlayhead,
  collapsed: collapsedProp,
  onCollapsedChange,
  analysisCandidates = [],
  onAddCandidate,
  candidatesBusy = false,
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
          {collapsed ? '▸' : '▾'} Archivos
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
              Añadir archivo
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
              accept="image/*,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp4,.mov,.mkv,.webm,.mp3,.wav,.m4a,.ogg"
              multiple
              hidden
              onChange={(event) => void handleUpload(event.target.files)}
            />
          </div>
          <p className="muted reel-nle__bin-hint">
            Sube música de fondo, videos extra o stickers. Cada archivo de audio o video arrastrado
            a la línea temporal tiene su propio volumen.
          </p>

          {error && <p className="error">{error}</p>}

          {analysisCandidates.length > 0 && (
            <div className="reel-nle__bin-candidates" aria-label="Cortes del análisis">
              <h4>Cortes del análisis</h4>
              <p className="muted">Añádelos al Reel; el formato largo o corto lo define lo que elijas aquí.</p>
              <ul>
                {analysisCandidates.map((candidate) => {
                  const duration = candidate.segments.reduce(
                    (sum, segment) => sum + Math.max(0, segment.end - segment.start),
                    0,
                  );
                  return (
                    <li key={candidate.id}>
                      <strong>{candidate.title}</strong>
                      <span className="muted">
                        {formatDuration(duration)} · {candidate.segments.length} fragmento(s)
                        {candidate.segments[0]
                          ? ` · ${formatTimecode(candidate.segments[0].start)}`
                          : ''}
                      </span>
                      {onAddCandidate && (
                        <button
                          type="button"
                          className="button button--inline"
                          disabled={candidatesBusy || candidate.status === 'accepted'}
                          onClick={() => onAddCandidate(candidate)}
                        >
                          {candidate.status === 'accepted' ? 'Ya añadido' : 'Añadir al Reel'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="reel-nle__bin-grid" aria-label="Recursos del proyecto">
            {assets.length === 0 ? (
              <p className="muted reel-nle__bin-empty">
                Sube imágenes, videos o música y arrástralos a la línea temporal.
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
                        onLoadedMetadata={(event) => {
                          const media = event.currentTarget;
                          if (Number.isFinite(media.duration) && media.duration > 0) {
                            media.currentTime = Math.min(
                              media.duration * 0.2,
                              Math.max(0.15, media.duration / 5),
                            );
                          }
                        }}
                      />
                    ) : asset.kind === 'audio' ? (
                      <span className="reel-nle__bin-audio" aria-hidden>
                        ♪
                      </span>
                    ) : (
                      <img
                        src={assetMediaSrc(asset.media_url)}
                        alt={asset.original_name ?? asset.filename}
                        draggable={false}
                      />
                    )}
                  </button>
                  <span className="reel-nle__bin-name" title={asset.original_name ?? asset.filename}>
                    {asset.kind === 'video' ? 'Video · ' : asset.kind === 'audio' ? 'Música · ' : asset.kind === 'image' ? 'Sticker · ' : ''}
                    {asset.original_name ?? asset.filename}
                  </span>
                  <span className="reel-nle__bin-meta">
                    {asset.kind === 'video'
                      ? 'Fuente extra · '
                      : asset.kind === 'audio'
                        ? 'Audio · '
                        : asset.kind === 'image'
                          ? 'Sticker · '
                          : ''}
                    {asset.duration_ms != null && asset.duration_ms > 0
                      ? formatDuration(asset.duration_ms / 1000)
                      : asset.kind === 'image'
                        ? 'imagen'
                        : 'duración al importar'}
                  </span>
                  {onAddAtPlayhead && (
                    <button
                      type="button"
                      className="button button--inline"
                      disabled={busy}
                      onClick={() => onAddAtPlayhead(asset.id)}
                    >
                      Añadir en playhead
                    </button>
                  )}
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
