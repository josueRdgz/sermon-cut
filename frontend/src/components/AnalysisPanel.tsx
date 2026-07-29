import { useCallback, useEffect, useState } from 'react';

import {
  acceptAnalysisCandidate,
  cancelAnalysisJob,
  getAnalysisJob,
  getAnalysisProviderStatus,
  getLatestAnalysis,
  rejectAnalysisCandidate,
  startAnalysis,
} from '../api/analysis';
import { ApiError } from '../api/client';
import { getTranscript } from '../api/transcripts';
import type { AnalysisCandidate, AnalysisJob, AnalysisProviderStatus } from '../types/analysis';
import { ACTIVE_ANALYSIS_STATUSES } from '../types/analysis';
import { formatDuration, formatTimecode } from '../utils/format';
import { ProgressBar } from './ProgressBar';

interface AnalysisPanelProps {
  projectId: string;
  transcriptRevision?: number;
  onCandidateAccepted?: (reelId: string) => void;
}

const POLL_INTERVAL_MS = 1500;

const STAGE_LABELS: Record<string, string> = {
  queued: 'En cola',
  preparing: 'Preparando',
  analysing: 'Analizando',
  merging: 'Combinando candidatos',
  validating: 'Validando evidencia',
  completed: 'Completado',
  cancelling: 'Cancelando',
  cancelled: 'Cancelado',
  failed: 'Error',
};

function isActive(job: AnalysisJob | null): boolean {
  return job != null && ACTIVE_ANALYSIS_STATUSES.includes(job.status);
}

function candidateDuration(candidate: AnalysisCandidate): number {
  return candidate.segments.reduce((sum, seg) => sum + Math.max(0, seg.end - seg.start), 0);
}

export function AnalysisPanel({
  projectId,
  transcriptRevision = 0,
  onCandidateAccepted,
}: AnalysisPanelProps) {
  const [provider, setProvider] = useState<AnalysisProviderStatus | null>(null);
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [maxReels, setMaxReels] = useState(5);
  const [minDuration, setMinDuration] = useState(20);
  const [maxDuration, setMaxDuration] = useState(60);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    getAnalysisProviderStatus()
      .then(setProvider)
      .catch(() => setProvider(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getTranscript(projectId)
      .then((data) => {
        if (!cancelled) {
          setHasTranscript(
            data.status === 'ready' &&
              data.segments.some((seg) => seg.start_seconds != null && seg.end_seconds != null),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setHasTranscript(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, transcriptRevision]);

  useEffect(() => {
    let cancelled = false;
    getLatestAnalysis(projectId)
      .then((data) => {
        if (!cancelled) setJob(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setJob(null);
          return;
        }
        setError(err instanceof Error ? err.message : 'No se pudo consultar el análisis');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!isActive(job) || job == null) return;
    const jobId = job.id;
    const timer = window.setInterval(() => {
      getAnalysisJob(jobId)
        .then(setJob)
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'No se pudo actualizar el análisis');
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [job]);

  const handleStart = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await startAnalysis(projectId, {
        max_reels: maxReels,
        min_duration_seconds: minDuration,
        max_duration_seconds: maxDuration,
        additional_instructions: instructions.trim() || null,
      });
      setJob(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el análisis');
    } finally {
      setBusy(false);
    }
  }, [projectId, maxReels, minDuration, maxDuration, instructions]);

  const handleCancel = useCallback(async () => {
    if (!job) return;
    setBusy(true);
    try {
      setJob(await cancelAnalysisJob(job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar');
    } finally {
      setBusy(false);
    }
  }, [job]);

  const refreshJob = useCallback(async () => {
    if (!job) return;
    setJob(await getAnalysisJob(job.id));
  }, [job]);

  const handleAccept = useCallback(
    async (candidateId: string) => {
      setActionId(candidateId);
      setError(null);
      try {
        const result = await acceptAnalysisCandidate(projectId, candidateId);
        await refreshJob();
        onCandidateAccepted?.(result.reel_id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo aceptar el candidato');
      } finally {
        setActionId(null);
      }
    },
    [projectId, refreshJob, onCandidateAccepted],
  );

  const handleReject = useCallback(
    async (candidateId: string) => {
      setActionId(candidateId);
      setError(null);
      try {
        await rejectAnalysisCandidate(projectId, candidateId);
        await refreshJob();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo descartar el candidato');
      } finally {
        setActionId(null);
      }
    },
    [projectId, refreshJob],
  );

  const active = isActive(job);
  const percent = job ? Math.round(job.progress * 100) : 0;
  const stageLabel = job?.stage ? (STAGE_LABELS[job.stage] ?? job.stage) : '—';
  const candidates = job?.candidates ?? [];

  return (
    <section className="card analysis-panel">
      <div className="reel-editor__section-header">
        <h2>Análisis editorial (IA opcional)</h2>
        {job && (
          <span className={`badge badge--${job.status}`}>
            {STAGE_LABELS[job.status] ?? job.status}
          </span>
        )}
      </div>

      <p className="muted">
        Sugiere Reels a partir de la transcripción. Gemini es opcional: sin clave la app usa un
        proveedor mock determinista. Ningún candidato se renderiza solo; debes aceptar o descartar
        cada uno.
      </p>
      <p className="muted">
        Ritmo editorial: se prioriza un pasaje continuo y, por defecto, cada Reel tendrá como
        máximo 3 fragmentos de al menos 8 segundos cada uno.
      </p>

      {provider?.gemini_configured && (
        <p className="error" role="note">
          Aviso de privacidad: al usar Gemini, el texto de la predicación (transcripción) se
          envía a los servidores de Google. Si el contenido es sensible o confidencial, usa solo el
          mock local. Detalles en docs/PRIVACY.md.
        </p>
      )}

      {provider && (
        <p className="muted">
          Proveedor activo: <strong>{provider.active}</strong>
          {provider.gemini_configured
            ? ` · Gemini configurado (${provider.gemini_model})`
            : ' · Gemini no configurado (SERMON_CUT_GEMINI_API_KEY)'}
          {!provider.gemini_sdk_installed && provider.gemini_configured
            ? ' · SDK ausente: pip install -e ".[gemini]"'
            : ''}
        </p>
      )}

      {!hasTranscript && (
        <p className="muted">Importa o genera una transcripción sincronizada para analizar.</p>
      )}

      {hasTranscript && (
        <>
          <div className="transcript-toolbar">
            <label className="field field--inline">
              <span>Máx. candidatos</span>
              <input
                type="number"
                min={1}
                max={20}
                value={maxReels}
                disabled={active || busy}
                onChange={(e) => setMaxReels(Number(e.target.value))}
              />
            </label>
            <label className="field field--inline">
              <span>Duración mín.</span>
              <input
                type="number"
                min={5}
                max={120}
                value={minDuration}
                disabled={active || busy}
                onChange={(e) => setMinDuration(Number(e.target.value))}
              />
              <span className="muted">s</span>
            </label>
            <label className="field field--inline">
              <span>Duración máx.</span>
              <input
                type="number"
                min={10}
                max={180}
                value={maxDuration}
                disabled={active || busy}
                onChange={(e) => setMaxDuration(Number(e.target.value))}
              />
              <span className="muted">s</span>
            </label>
          </div>

          <label className="field">
            <span>Instrucciones adicionales (opcional)</span>
            <textarea
              rows={3}
              value={instructions}
              disabled={active || busy}
              placeholder="p. ej. priorizar aplicación pastoral y frases memorables sobre la gracia"
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>

          <div className="button-stack">
            {!active && (
              <button type="button" onClick={() => void handleStart()} disabled={busy}>
                {busy ? 'Iniciando…' : 'Iniciar análisis'}
              </button>
            )}
            {active && (
              <button
                type="button"
                className="button--danger"
                onClick={() => void handleCancel()}
                disabled={busy || job?.status === 'cancelling'}
              >
                {job?.status === 'cancelling' ? 'Cancelando…' : 'Cancelar análisis'}
              </button>
            )}
          </div>

          {active && job && (
            <div className="transcription-progress">
              <ProgressBar label={stageLabel} percent={percent} />
              <p className="muted">
                Bloques {job.chunks_completed}/{job.chunk_count || '—'}
                {job.total_tokens != null ? ` · ${job.total_tokens} tokens` : ''}
              </p>
            </div>
          )}

          {job?.notice && <p className="warning">{job.notice}</p>}
          {job?.status === 'failed' && (
            <p className="error">Error: {job.error_message ?? 'falló el análisis'}</p>
          )}
          {job?.status === 'completed' && job.rejected_count > 0 && (
            <p className="muted">
              {job.rejected_count} candidato(s) descartados automáticamente por falta de evidencia
              en la transcripción.
            </p>
          )}

          {candidates.length > 0 && (
            <div className="analysis-candidates">
              <h3>Candidatos</h3>
              <p className="muted">
                Revisa cada sugerencia. Aceptar crea un Reel en borrador; no inicia el render.
              </p>
              <ol className="analysis-candidates__list">
                {candidates.map((candidate) => (
                  <li key={candidate.id} className="analysis-candidate">
                    <div className="analysis-candidate__header">
                      <strong>
                        {candidate.rank + 1}. {candidate.title}
                      </strong>
                      <span className={`badge badge--${candidate.status}`}>
                        {candidate.status === 'pending'
                          ? 'Pendiente'
                          : candidate.status === 'accepted'
                            ? 'Aceptado'
                            : 'Descartado'}
                      </span>
                    </div>
                    <p className="muted">
                      Score {candidate.editorial_score.toFixed(1)} · confianza{' '}
                      {Math.round(candidate.confidence * 100)}% ·{' '}
                      {formatDuration(candidateDuration(candidate))} · {candidate.segments.length}{' '}
                      fragmento(s)
                    </p>
                    {candidate.hook && <p>{candidate.hook}</p>}
                    {candidate.summary && <p className="muted">{candidate.summary}</p>}
                    <ul className="analysis-candidate__segments">
                      {candidate.segments.map((segment, index) => (
                        <li key={`${candidate.id}-${index}`}>
                          <span className="reel-timeline__range">
                            {formatTimecode(segment.start)} – {formatTimecode(segment.end)}
                          </span>
                          <span>{segment.exact_text}</span>
                          {segment.reason && <span className="muted"> · {segment.reason}</span>}
                        </li>
                      ))}
                    </ul>
                    {candidate.warnings.length > 0 && (
                      <ul className="analysis-candidate__warnings">
                        {candidate.warnings.map((warning) => (
                          <li key={warning} className="warning">
                            {warning}
                          </li>
                        ))}
                      </ul>
                    )}
                    {candidate.status === 'pending' && (
                      <div className="button-stack">
                        <button
                          type="button"
                          disabled={actionId === candidate.id}
                          onClick={() => void handleAccept(candidate.id)}
                        >
                          {actionId === candidate.id ? 'Aceptando…' : 'Aceptar'}
                        </button>
                        <button
                          type="button"
                          className="button--ghost"
                          disabled={actionId === candidate.id}
                          onClick={() => void handleReject(candidate.id)}
                        >
                          Descartar
                        </button>
                      </div>
                    )}
                    {candidate.status === 'accepted' && candidate.accepted_reel_id && (
                      <p className="muted">Reel creado: {candidate.accepted_reel_id}</p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
