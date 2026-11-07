import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import {
  assetMediaSrc,
  deleteAsset,
  listAssets,
  uploadAsset,
} from '../api/assets';
import type { AnalysisCandidate } from '../types/analysis';
import type { ProjectAsset } from '../types/asset';
import { formatDuration } from '../utils/format';
import { addableAnalysisCandidates, AnalysisProposalList } from './AnalysisProposalList';

const ASSET_MIME = 'application/x-sermon-asset';

interface MediaBinPanelProps {
  projectId: string;
  assets: ProjectAsset[];
  onAssetsChange: (assets: ProjectAsset[]) => void;
  onAddTextAtPlayhead?: () => void;
  onAddAtPlayhead?: (assetId: string) => void;
  analysisCandidates?: AnalysisCandidate[];
  onAddCandidate?: (candidate: AnalysisCandidate) => void;
  candidatesBusy?: boolean;
  addedCandidateIds?: string[];
  currentReelId?: string | null;
}

export function MediaBinPanel({
  projectId,
  assets,
  onAssetsChange,
  onAddTextAtPlayhead,
  onAddAtPlayhead,
  analysisCandidates = [],
  onAddCandidate,
  candidatesBusy = false,
  addedCandidateIds = [],
  currentReelId = null,
}: MediaBinPanelProps) {
  const addableCandidates = addableAnalysisCandidates(
    analysisCandidates,
    currentReelId,
    addedCandidateIds,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="reel-nle__files">
      <div className="reel-nle__bin-actions">
        <button
          type="button"
          className="button button--secondary"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Importar archivo
        </button>
        {onAddTextAtPlayhead && (
          <button
            type="button"
            className="button button--secondary"
            disabled={busy}
            onClick={onAddTextAtPlayhead}
          >
            Añadir texto
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

      {error && <p className="error">{error}</p>}

      {addableCandidates.length > 0 && (
        <div className="reel-nle__bin-candidates" aria-label="Propuestas del análisis">
          <h4>Propuestas del análisis</h4>
          <AnalysisProposalList
            compact
            addOnly
            candidates={addableCandidates}
            busy={candidatesBusy}
            canAddToReel={Boolean(onAddCandidate)}
            currentReelId={currentReelId}
            addedCandidateIds={addedCandidateIds}
            onAddToReel={onAddCandidate}
          />
        </div>
      )}

      <div className="reel-nle__bin-grid" aria-label="Recursos del proyecto">
        {assets.length === 0 ? (
          <p className="muted reel-nle__bin-empty">
            Importa imágenes, videos o música y arrástralos a la línea temporal.
          </p>
        ) : (
          assets.map((asset) => (
            <div key={asset.id} className="reel-nle__bin-item">
              <div className="reel-nle__bin-thumb-wrap">
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
                {onAddAtPlayhead && (
                  <button
                    type="button"
                    className="reel-nle__bin-add"
                    disabled={busy}
                    title="Añadir"
                    aria-label={`Añadir ${asset.original_name ?? asset.filename}`}
                    onClick={() => onAddAtPlayhead(asset.id)}
                  >
                    <Plus size={12} strokeWidth={2.75} aria-hidden />
                  </button>
                )}
              </div>
              <span className="reel-nle__bin-name" title={asset.original_name ?? asset.filename}>
                {asset.original_name ?? asset.filename}
              </span>
              <span className="reel-nle__bin-meta">
                {asset.kind === 'video'
                  ? 'Video'
                  : asset.kind === 'audio'
                    ? 'Música'
                    : asset.kind === 'image'
                      ? 'Imagen'
                      : 'Archivo'}
                {asset.duration_ms != null && asset.duration_ms > 0
                  ? ` · ${formatDuration(asset.duration_ms / 1000)}`
                  : ''}
              </span>
              <button
                type="button"
                className="button button--danger reel-nle__bin-remove"
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
    </div>
  );
}
