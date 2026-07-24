import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  cancelRenderJob,
  getLatestRender,
  getRenderJob,
  renderOutputUrl,
  startRender,
} from '../api/renders';
import type { AspectRatio } from '../types/reel';
import type { RenderJob, RenderLayout } from '../types/render';
import { ACTIVE_RENDER_STATUSES } from '../types/render';
import { formatDuration } from '../utils/format';
import { ProgressBar } from './ProgressBar';

interface RenderPanelProps {
  projectId: string;
  reelId: string;
  reelAspectRatio: AspectRatio;
  segmentCount: number;
}

const POLL_INTERVAL_MS = 1500;

const LAYOUT_OPTIONS: { value: RenderLayout; label: string }[] = [
  { value: 'center_crop', label: 'Recorte centrado' },
  { value: 'blurred_background', label: 'Fondo desenfocado' },
];

const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '9:16', label: '9:16 · 1080 × 1920' },
  { value: '1:1', label: '1:1 · 1080 × 1080' },
  { value: '16:9', label: '16:9 · 1920 × 1080' },
];

const STAGE_LABELS: Record<string, string> = {
  queued: 'En cola',
  preparing: 'Preparando',
  encoding: 'Codificando',
  finalizing: 'Finalizando',
  completed: 'Completado',
  cancelling: 'Cancelando',
  cancelled: 'Cancelado',
  failed: 'Error',
};

function isActive(job: RenderJob | null): boolean {
  return job != null && ACTIVE_RENDER_STATUSES.includes(job.status);
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function RenderPanel({
  projectId,
  reelId,
  reelAspectRatio,
  segmentCount,
}: RenderPanelProps) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(reelAspectRatio);
  const [layout, setLayout] = useState<RenderLayout>('center_crop');
  const [normalizeLoudness, setNormalizeLoudness] = useState(true);
  const [showCommand, setShowCommand] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previousReelRef = useRef<string>(reelId);

  useEffect(() => {
    setAspectRatio(reelAspectRatio);
  }, [reelAspectRatio]);

  // Load the latest job whenever the selected reel changes.
  useEffect(() => {
    let cancelled = false;
    if (previousReelRef.current !== reelId) {
      previousReelRef.current = reelId;
      setJob(null);
      setError(null);
    }
    getLatestRender(projectId, reelId)
      .then((data) => {
        if (!cancelled) setJob(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setJob(null);
          return;
        }
        setError(err instanceof Error ? err.message : 'No se pudo consultar el render');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reelId]);

  useEffect(() => {
    if (!isActive(job) || job == null) return;
    const jobId = job.id;
    const timer = window.setInterval(() => {
      getRenderJob(jobId)
        .then(setJob)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'No se pudo actualizar el estado');
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [job]);

  const handleStart = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await startRender(projectId, reelId, {
        aspect_ratio: aspectRatio,
        layout,
        normalize_loudness: normalizeLoudness,
      });
      setJob(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el render');
    } finally {
      setBusy(false);
    }
  }, [projectId, reelId, aspectRatio, layout, normalizeLoudness]);

  const handleCancel = useCallback(async () => {
    if (!job) return;
    setBusy(true);
    try {
      setJob(await cancelRenderJob(job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar el render');
    } finally {
      setBusy(false);
    }
  }, [job]);

  const active = isActive(job);
  const percent = job ? Math.round(job.progress * 100) : 0;
  const stageLabel = job?.stage ? (STAGE_LABELS[job.stage] ?? job.stage) : '—';
  const canRender = segmentCount > 0;

  return (
    <div className="render-panel">
      <div className="reel-editor__section-header">
        <h4>Exportar video (MP4 H.264 + AAC)</h4>
        {job && (
          <span className={`badge badge--${job.status}`}>
            {STAGE_LABELS[job.status] ?? job.status}
          </span>
        )}
      </div>

      {!canRender && (
        <p className="muted">Añade al menos un fragmento al Reel para poder exportarlo.</p>
      )}

      {canRender && (
        <>
          <div className="transcript-toolbar">
            <label className="field field--inline">
              <span>Formato</span>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                disabled={active || busy}
              >
                {ASPECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline">
              <span>Encuadre</span>
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value as RenderLayout)}
                disabled={active || busy}
              >
                {LAYOUT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline field--checkbox">
              <input
                type="checkbox"
                checked={normalizeLoudness}
                onChange={(e) => setNormalizeLoudness(e.target.checked)}
                disabled={active || busy}
              />
              <span>Normalizar audio</span>
            </label>
            <div className="button-stack">
              {!active && (
                <button type="button" onClick={() => void handleStart()} disabled={busy}>
                  {busy ? 'Iniciando…' : 'Renderizar'}
                </button>
              )}
              {active && (
                <button
                  type="button"
                  className="button--danger"
                  onClick={() => void handleCancel()}
                  disabled={busy || job?.status === 'cancelling'}
                >
                  {job?.status === 'cancelling' ? 'Cancelando…' : 'Cancelar render'}
                </button>
              )}
            </div>
          </div>

          <p className="muted">
            Sin subtítulos ni pantalla final todavía. Los fragmentos se recodifican para que los
            cortes sean exactos.
          </p>

          {active && job && (
            <div className="transcription-progress">
              <ProgressBar label={stageLabel} percent={percent} />
              <p className="muted">
                {formatDuration(job.processed_seconds)} / {formatDuration(job.total_seconds)}
                {job.speed ? ` · ${job.speed.toFixed(2)}×` : ''}
                {job.width && job.height ? ` · ${job.width}×${job.height}` : ''}
              </p>
            </div>
          )}

          {job?.status === 'completed' && job.output_filename && (
            <div className="render-result">
              <video
                className="render-result__video"
                src={renderOutputUrl(job.id)}
                controls
                preload="metadata"
              />
              <div className="render-result__meta">
                <p>
                  <strong>{job.output_filename}</strong>
                </p>
                <p className="muted">
                  {job.width}×{job.height}
                  {job.fps ? ` · ${job.fps} fps` : ''} · {formatDuration(job.total_seconds)} ·{' '}
                  {formatSize(job.output_size_bytes)}
                </p>
                <a
                  className="button-link"
                  href={renderOutputUrl(job.id, true)}
                  download={job.output_filename}
                >
                  Descargar MP4
                </a>
              </div>
            </div>
          )}

          {job?.status === 'cancelled' && <p className="muted">Render cancelado.</p>}

          {job?.status === 'failed' && (
            <p className="error">Error: {job.error_message ?? 'falló el render'}</p>
          )}

          {job?.ffmpeg_command && (
            <div className="render-debug">
              <button
                type="button"
                className="button--ghost"
                onClick={() => setShowCommand((value) => !value)}
              >
                {showCommand ? 'Ocultar comando FFmpeg' : 'Ver comando FFmpeg'}
              </button>
              {showCommand && <pre className="render-debug__command">{job.ffmpeg_command}</pre>}
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
