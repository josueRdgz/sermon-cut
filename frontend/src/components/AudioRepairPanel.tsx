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
  const [maxAutoRepairMs, setMaxAutoRepairMs] = useState(60);
  const originalRef = useRef<HTMLAudioElement>(null);
  const repairedRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLatestAudioRepair(projectId)
      .then((result) => {
        if (!cancelled) {
          setJob(result);
          setMaxAutoRepairMs(result.max_auto_repair_ms);
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

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const result = await startAudioRepair(projectId, {
        silence_threshold: 8,
        min_dropout_ms: 2,
        max_auto_repair_ms: maxAutoRepairMs,
        max_review_ms: 250,
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

  return (
    <div className="audio-repair">
      <section className="card">
        <h2>Reparar microcortes</h2>
        <p className="muted">
          El análisis se ejecuta localmente. Sólo reconstruye huecos digitales breves con señal
          activa a ambos lados; los pasajes dudosos quedan marcados para revisión.
        </p>

        <details className="audio-repair__settings">
          <summary>Ajuste conservador</summary>
          <label>
            Reparar automáticamente hasta {maxAutoRepairMs} ms
            <input
              type="range"
              min="20"
              max="80"
              step="5"
              value={maxAutoRepairMs}
              disabled={active}
              onChange={(event) => setMaxAutoRepairMs(Number(event.target.value))}
            />
          </label>
          <small>
            Los huecos más largos no se modifican porque podrían contener una sílaba o palabra
            perdida.
          </small>
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
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void handleStart()}
          >
            {completed ? 'Analizar de nuevo' : 'Analizar y reparar audio'}
          </button>
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
