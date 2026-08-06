import { useEffect, useRef, useState } from 'react';

import {
  cancelAudioRepair,
  getAudioRepairJob,
  getLatestAudioRepair,
  repairedAudioUrl,
  repairedVideoUrl,
  startAudioRepair,
} from '../api/audioRepair';
import { ApiError } from '../api/client';
import { projectVideoUrl } from '../api/projects';
import type { AudioRepairJob, AudioRepairIssue } from '../types/audioRepair';
import { formatDuration } from '../utils/format';
import { ProgressBar } from './ProgressBar';

interface AudioRepairPanelProps {
  projectId: string;
  hasVideo: boolean;
}

const ACTIVE_STATUSES = new Set(['queued', 'running', 'cancelling']);
const DEFAULT_MAX_AUTO_MS = 200;
const DEFAULT_MAX_REVIEW_MS = 250;
const SLIDER_MIN_MS = 20;
const SLIDER_MAX_MS = 200;

const STAGE_LABELS: Record<string, string> = {
  queued: 'En espera',
  extracting_audio: 'Extrayendo audio PCM',
  analyzing: 'Buscando microcortes',
  repairing: 'Reconstruyendo microcortes seguros',
  creating_video: 'Creando copia de video',
  cancelling: 'Cancelando',
  completed: 'Terminado',
  cancelled: 'Cancelado',
  failed: 'Falló',
};

function issueTime(issue: AudioRepairIssue): string {
  return formatDuration(issue.start_seconds);
}

export function AudioRepairPanel({ projectId, hasVideo }: AudioRepairPanelProps) {
  const [job, setJob] = useState<AudioRepairJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxAutoRepairMs, setMaxAutoRepairMs] = useState(DEFAULT_MAX_AUTO_MS);
  const [repairReviewItems, setRepairReviewItems] = useState(false);
  const originalRef = useRef<HTMLAudioElement>(null);
  const repairedRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLatestAudioRepair(projectId)
      .then((result) => {
        if (!cancelled) {
          setJob(result);
          const usedFullReview =
            result.max_auto_repair_ms >= result.max_review_ms - 0.001;
          setRepairReviewItems(usedFullReview);
          setMaxAutoRepairMs(
            usedFullReview
              ? DEFAULT_MAX_AUTO_MS
              : Math.min(result.max_auto_repair_ms, SLIDER_MAX_MS),
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 404)) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar la reparación');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.has(job.status)) return;
    const timer = window.setInterval(() => {
      getAudioRepairJob(job.id)
        .then(setJob)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'No se pudo actualizar el progreso');
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job]);

  async function runRepair(includeReviewItems: boolean) {
    setBusy(true);
    setError(null);
    setRepairReviewItems(includeReviewItems);
    try {
      const result = await startAudioRepair(projectId, {
        silence_threshold: 8,
        min_dropout_ms: 2,
        max_auto_repair_ms: maxAutoRepairMs,
        max_review_ms: DEFAULT_MAX_REVIEW_MS,
        repair_review_items: includeReviewItems,
      });
      setJob(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la reparación');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!job) return;
    setBusy(true);
    try {
      setJob(await cancelAudioRepair(job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar');
    } finally {
      setBusy(false);
    }
  }

  function seekComparison(issue: AudioRepairIssue) {
    const target = Math.max(0, issue.start_seconds - 2);
    if (originalRef.current) originalRef.current.currentTime = target;
    if (repairedRef.current) repairedRef.current.currentTime = target;
    originalRef.current?.play().catch(() => undefined);
  }

  if (loading) {
    return (
      <section className="card">
        <p className="muted">Cargando reparación de audio…</p>
      </section>
    );
  }

  if (!hasVideo) {
    return (
      <section className="card">
        <h2>Reparar audio</h2>
        <p className="muted">Sube un video al proyecto para analizar su pista de audio.</p>
      </section>
    );
  }

  const active = job ? ACTIVE_STATUSES.has(job.status) : false;
  const completed = job?.status === 'completed';
  const pendingReview = completed && job ? job.review_count > 0 : false;

  return (
    <div className="audio-repair">
      <section className="card">
        <h2>Reparar microcortes</h2>
        <p className="muted">
          El análisis se ejecuta localmente. Sólo suaviza cortes digitales bruscos (voz
          interrumpida a silencio); no inventa ni espeja palabras. Las micro-pausas naturales
          se dejan intactas y los huecos dudosos quedan para revisión.
        </p>

        <details className="audio-repair__settings" open={repairReviewItems || pendingReview}>
          <summary>Ajuste de reparación</summary>
          <label>
            Reparar automáticamente hasta {maxAutoRepairMs} ms
            <input
              type="range"
              min={SLIDER_MIN_MS}
              max={SLIDER_MAX_MS}
              step="10"
              value={maxAutoRepairMs}
              disabled={active || repairReviewItems}
              onChange={(event) => setMaxAutoRepairMs(Number(event.target.value))}
            />
          </label>
          <small>
            Por defecto repara huecos de hasta 200 ms. Los más largos (hasta{' '}
            {DEFAULT_MAX_REVIEW_MS} ms) quedan marcados para revisión.
          </small>

          <label className="audio-repair__checkbox">
            <input
              type="checkbox"
              checked={repairReviewItems}
              disabled={active}
              onChange={(event) => setRepairReviewItems(event.target.checked)}
            />
            <span>
              Reparar también los marcados para revisar
              <small>
                Acepta reconstruir todos los huecos detectados (hasta {DEFAULT_MAX_REVIEW_MS} ms).
                Úsalo sólo si ya revisaste o quieres aplicar todo de una vez.
              </small>
            </span>
          </label>
        </details>

        {active && job ? (
          <>
            <ProgressBar
              label={STAGE_LABELS[job.stage ?? ''] ?? 'Procesando audio'}
              percent={Math.round(job.progress * 100)}
            />
            <button
              type="button"
              className="button button--secondary"
              disabled={busy || job.status === 'cancelling'}
              onClick={() => void handleCancel()}
            >
              Cancelar
            </button>
          </>
        ) : (
          <div className="audio-repair__actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void runRepair(repairReviewItems)}
            >
              {completed
                ? repairReviewItems
                  ? 'Analizar y reparar todo'
                  : 'Analizar de nuevo'
                : repairReviewItems
                  ? 'Analizar y reparar todo'
                  : 'Analizar y reparar audio'}
            </button>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {job?.status === 'failed' && (
          <p className="error">{job.error_message ?? 'La reparación no pudo completarse.'}</p>
        )}
      </section>

      {completed && job && (
        <>
          <section className="card">
            <h2>Resultado</h2>
            <div className="audio-repair__metrics">
              <div>
                <strong>{job.issue_count}</strong>
                <span>posibles microcortes</span>
              </div>
              <div>
                <strong>{job.repaired_count}</strong>
                <span>reparados</span>
              </div>
              <div>
                <strong>{job.review_count}</strong>
                <span>para revisar</span>
              </div>
            </div>

            {pendingReview && !active && (
              <div className="audio-repair__accept-all">
                <p>
                  Hay <strong>{job.review_count}</strong> incidencia
                  {job.review_count === 1 ? '' : 's'} marcada
                  {job.review_count === 1 ? '' : 's'} para revisar. Puedes aceptar repararlas
                  todas ahora.
                </p>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void runRepair(true)}
                >
                  Aceptar y reparar todo
                </button>
              </div>
            )}

            {job.has_repaired_video && (
              <a className="button button--inline" href={repairedVideoUrl(job.id, true)}>
                Descargar video reparado
              </a>
            )}
            <p className="muted audio-repair__notice">
              El video original permanece intacto. Esta copia sólo sustituye su pista de audio.
            </p>
          </section>

          <section className="card">
            <h2>Comparación A/B</h2>
            <div className="audio-repair__players">
              <label>
                <span>Original</span>
                <audio
                  ref={originalRef}
                  controls
                  preload="metadata"
                  src={projectVideoUrl(projectId)}
                />
              </label>
              <label>
                <span>Reparado</span>
                <audio
                  ref={repairedRef}
                  controls
                  preload="metadata"
                  src={repairedAudioUrl(job.id)}
                />
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Incidencias</h2>
            {job.issues.length === 0 ? (
              <p className="muted">
                No se detectaron huecos digitales con suficiente confianza. El archivo reparado
                conserva el audio original.
              </p>
            ) : (
              <div className="audio-repair__issues">
                {job.issues.map((issue, index) => (
                  <button
                    key={`${issue.start_seconds}-${index}`}
                    type="button"
                    className="audio-repair__issue"
                    onClick={() => seekComparison(issue)}
                  >
                    <span>
                      <strong>{issueTime(issue)}</strong>
                      <small>{issue.duration_ms.toFixed(1)} ms</small>
                    </span>
                    <span className={issue.repaired ? 'status-ok' : 'status-warning'}>
                      {issue.repaired ? 'Reparado' : 'Revisar'}
                    </span>
                    <small>{Math.round(issue.confidence * 100)}% confianza · escuchar</small>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
