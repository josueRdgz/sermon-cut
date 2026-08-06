import { useEffect, useRef, useState } from 'react';

import {
  applyAudioRepair,
  cancelAudioRepair,
  downloadRepairFile,
  getAudioRepairJob,
  getLatestAudioRepair,
  originalAudioUrl,
  repairedAudioUrl,
  repairedVideoUrl,
  startAudioRepair,
} from '../api/audioRepair';
import { ApiError } from '../api/client';
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
const MAX_VISIBLE_ISSUES = 200;

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
  const [applied, setApplied] = useState(false);
  const [maxAutoRepairMs, setMaxAutoRepairMs] = useState(DEFAULT_MAX_AUTO_MS);
  const [repairReviewItems, setRepairReviewItems] = useState(false);
  const originalAudioRef = useRef<HTMLAudioElement>(null);
  const repairedAudioRef = useRef<HTMLAudioElement>(null);
  const repairedVideoRef = useRef<HTMLVideoElement>(null);

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
    setApplied(false);
    setRepairReviewItems(includeReviewItems);
    try {
      const result = await startAudioRepair(projectId, {
        silence_threshold: 64,
        min_dropout_ms: 1.0,
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

  async function handleApply() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      setJob(await applyAudioRepair(job.id));
      setApplied(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'audio_repair_already_applied') {
        setApplied(true);
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo aplicar la reparación');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(url: string, filename: string) {
    setBusy(true);
    setError(null);
    try {
      await downloadRepairFile(url, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar el archivo');
    } finally {
      setBusy(false);
    }
  }

  function seekComparison(issue: AudioRepairIssue) {
    const target = Math.max(0, issue.start_seconds - 0.5);
    const players: Array<HTMLMediaElement | null> = [
      originalAudioRef.current,
      repairedAudioRef.current,
      repairedVideoRef.current,
    ];
    for (const player of players) {
      if (!player) continue;
      try {
        player.pause();
        player.currentTime = target;
      } catch {
        // Seeking can throw before metadata is ready; ignore and still try play.
      }
    }
    void originalAudioRef.current?.play().catch(() => undefined);
    void repairedAudioRef.current?.play().catch(() => undefined);
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
  const visibleIssues = job ? job.issues.slice(0, MAX_VISIBLE_ISSUES) : [];
  const hiddenIssueCount = job ? Math.max(0, job.issues.length - MAX_VISIBLE_ISSUES) : 0;
  const hasOriginalAudio = Boolean(job?.has_original_audio);

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

            {job.has_repaired_video && !applied && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void handleApply()}
              >
                Usar audio reparado en el proyecto
              </button>
            )}
            {applied && (
              <p className="status-ok">
                Audio reparado aplicado. El editor de reel, la transcripción y el render usarán
                esta pista.
              </p>
            )}

            <div className="audio-repair__actions">
              {job.has_repaired_video && (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void handleDownload(repairedVideoUrl(job.id, true), 'repaired-video.mp4')
                  }
                >
                  Descargar video reparado
                </button>
              )}
              {job.has_repaired_audio && (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() =>
                    void handleDownload(repairedAudioUrl(job.id, true), 'repaired-audio.wav')
                  }
                >
                  Descargar audio reparado
                </button>
              )}
            </div>
            <p className="muted audio-repair__notice">
              Tras reparar, pulsa «Usar audio reparado en el proyecto» para que el editor de reel
              use esta pista. El video original se conserva como respaldo.
            </p>
          </section>

          <section className="card">
            <h2>Comparación A/B</h2>
            <p className="muted audio-repair__notice">
              Usa las pistas WAV (seek fiable). Pulsa una incidencia para saltar a ese punto. El
              video reparado lleva faststart para poder adelantar/atrasar.
            </p>
            <div className="audio-repair__players">
              <label>
                <span>Original (audio)</span>
                {hasOriginalAudio ? (
                  <audio
                    ref={originalAudioRef}
                    controls
                    preload="auto"
                    src={originalAudioUrl(job.id)}
                  />
                ) : (
                  <p className="muted">
                    Vuelve a analizar para generar la pista original comparable.
                  </p>
                )}
              </label>
              <label>
                <span>Reparado (audio)</span>
                {job.has_repaired_audio ? (
                  <audio
                    ref={repairedAudioRef}
                    controls
                    preload="auto"
                    src={repairedAudioUrl(job.id)}
                  />
                ) : (
                  <p className="muted">Audio reparado no disponible.</p>
                )}
              </label>
            </div>
            {job.has_repaired_video && (
              <label className="audio-repair__video-preview">
                <span>Video reparado (vista)</span>
                <video
                  ref={repairedVideoRef}
                  controls
                  preload="metadata"
                  src={repairedVideoUrl(job.id)}
                />
              </label>
            )}
          </section>

          <section className="card">
            <h2>Incidencias</h2>
            {job.issues.length === 0 ? (
              <p className="muted">
                No se detectaron huecos digitales con suficiente confianza. El archivo reparado
                conserva el audio original.
              </p>
            ) : (
              <>
                {hiddenIssueCount > 0 && (
                  <p className="muted">
                    Mostrando {MAX_VISIBLE_ISSUES} de {job.issues.length}
                  </p>
                )}
                <div className="audio-repair__issues">
                  {visibleIssues.map((issue, index) => (
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
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
