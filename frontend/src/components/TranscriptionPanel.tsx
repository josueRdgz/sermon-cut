import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  cancelTranscriptionJob,
  getLatestTranscription,
  getTranscriptionJob,
  startTranscription,
} from '../api/transcription';
import type {
  TranscriptionJob,
  TranscriptionLanguage,
  WhisperModelName,
} from '../types/transcription';
import { ACTIVE_TRANSCRIPTION_STATUSES } from '../types/transcription';
import { formatDuration } from '../utils/format';
import { ProgressBar } from './ProgressBar';

interface TranscriptionPanelProps {
  projectId: string;
  hasVideo: boolean;
  onCompleted: () => void;
}

const POLL_INTERVAL_MS = 1500;

const MODEL_OPTIONS: { value: WhisperModelName; label: string }[] = [
  { value: 'tiny', label: 'tiny (más rápido, menor calidad)' },
  { value: 'base', label: 'base' },
  { value: 'small', label: 'small (recomendado)' },
  { value: 'medium', label: 'medium (mayor calidad)' },
  { value: 'large-v3', label: 'large-v3 (máxima calidad, lento)' },
];

const LANGUAGE_OPTIONS: { value: TranscriptionLanguage; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
];

const STAGE_LABELS: Record<string, string> = {
  queued: 'En cola',
  extracting_audio: 'Extrayendo audio',
  loading_model: 'Cargando modelo',
  transcribing: 'Transcribiendo',
  saving: 'Guardando',
  completed: 'Completado',
  cancelling: 'Cancelando',
  cancelled: 'Cancelado',
  failed: 'Error',
};

function isActive(job: TranscriptionJob | null): boolean {
  return job != null && ACTIVE_TRANSCRIPTION_STATUSES.includes(job.status);
}

export function TranscriptionPanel({ projectId, hasVideo, onCompleted }: TranscriptionPanelProps) {
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [model, setModel] = useState<WhisperModelName>('small');
  const [language, setLanguage] = useState<TranscriptionLanguage>('auto');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastStatusRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLatestTranscription(projectId)
      .then((data) => {
        if (!cancelled) setJob(data);
      })
      .catch((err: unknown) => {
        if (!cancelled && !(err instanceof ApiError && err.status === 404)) {
          setError(err instanceof Error ? err.message : 'No se pudo consultar la transcripción');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Poll while a job is active.
  useEffect(() => {
    if (!isActive(job) || job == null) return;
    const jobId = job.id;
    const timer = window.setInterval(() => {
      getTranscriptionJob(jobId)
        .then(setJob)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'No se pudo actualizar el estado');
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [job]);

  // Reload the transcript once a run finishes successfully.
  useEffect(() => {
    if (!job) return;
    if (lastStatusRef.current !== 'completed' && job.status === 'completed') {
      onCompleted();
    }
    lastStatusRef.current = job.status;
  }, [job, onCompleted]);

  const handleStart = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await startTranscription(projectId, { model_name: model, language });
      setJob(started);
      lastStatusRef.current = started.status;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la transcripción');
    } finally {
      setBusy(false);
    }
  }, [projectId, model, language]);

  const handleCancel = useCallback(async () => {
    if (!job) return;
    setBusy(true);
    try {
      const updated = await cancelTranscriptionJob(job.id);
      setJob(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar');
    } finally {
      setBusy(false);
    }
  }, [job]);

  const active = isActive(job);
  const percent = job ? Math.round(job.progress * 100) : 0;
  const stageLabel = job?.stage ? (STAGE_LABELS[job.stage] ?? job.stage) : '—';

  return (
    <section className="card transcription-panel">
      <div className="transcript-editor__header">
        <h3>Transcripción automática (local)</h3>
        {job && (
          <span className={`badge badge--${job.status}`}>
            {STAGE_LABELS[job.status] ?? job.status}
          </span>
        )}
      </div>

      {!hasVideo && <p className="muted">Sube un video al proyecto para poder transcribir.</p>}

      {hasVideo && (
        <>
          <div className="transcript-toolbar">
            <label className="field field--inline">
              <span>Modelo</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as WhisperModelName)}
                disabled={active || busy}
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline">
              <span>Idioma</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as TranscriptionLanguage)}
                disabled={active || busy}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-stack">
              {!active && (
                <button type="button" onClick={() => void handleStart()} disabled={busy}>
                  {busy ? 'Iniciando…' : 'Transcribir'}
                </button>
              )}
              {active && (
                <button
                  type="button"
                  className="button--danger"
                  onClick={() => void handleCancel()}
                  disabled={busy || job?.status === 'cancelling'}
                >
                  {job?.status === 'cancelling' ? 'Cancelando…' : 'Cancelar'}
                </button>
              )}
            </div>
          </div>

          {active && job && (
            <div className="transcription-progress">
              <ProgressBar label={`${stageLabel}`} percent={percent} />
              <p className="muted">
                {formatDuration(job.processed_seconds)} / {formatDuration(job.total_seconds)}
                {job.device
                  ? ` · ${job.device}${job.compute_type ? ` (${job.compute_type})` : ''}`
                  : ''}
              </p>
            </div>
          )}

          {job?.notice && <p className="notice">{job.notice}</p>}

          {job?.status === 'completed' && (
            <p className="muted">
              Transcripción completada
              {job.detected_language ? ` · idioma detectado: ${job.detected_language}` : ''}.
            </p>
          )}

          {job?.status === 'cancelled' && <p className="muted">Transcripción cancelada.</p>}

          {job?.status === 'failed' && (
            <p className="error">Error: {job.error_message ?? 'falló la transcripción'}</p>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
