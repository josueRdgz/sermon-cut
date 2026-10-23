import { useCallback, useEffect, useState } from 'react';

import {
  cancelAnalysisJob,
  getAnalysisJob,
  getAnalysisProviderStatus,
  getLatestAnalysis,
  startAnalysis,
} from '../api/analysis';
import { ApiError } from '../api/client';
import { getTranscript } from '../api/transcripts';
import type { AnalysisCandidate, AnalysisJob, AnalysisProviderStatus } from '../types/analysis';
import { ACTIVE_ANALYSIS_STATUSES } from '../types/analysis';
import {
  ANALYSIS_OUTPUT_PRESETS,
  EDITORIAL_PRESETS,
  YOUTH_CONTEXT,
  buildAnalysisInstructions,
  type AnalysisOutputKind,
  type EditorialPresetId,
} from '../utils/editorialPresets';
import { formatDuration, formatTimecode } from '../utils/format';
import { ProgressBar } from './ProgressBar';

interface AnalysisPanelProps {
  projectId: string;
  transcriptRevision?: number;
  sourceKind?: 'full_service' | 'sermon_only';
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
  sourceKind = 'sermon_only',
}: AnalysisPanelProps) {
  const [provider, setProvider] = useState<AnalysisProviderStatus | null>(null);
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [outputKind, setOutputKind] = useState<AnalysisOutputKind>('shorts');
  const [maxReels, setMaxReels] = useState(5);
  const [minDuration, setMinDuration] = useState(ANALYSIS_OUTPUT_PRESETS.shorts.minDuration);
  const [maxDuration, setMaxDuration] = useState(ANALYSIS_OUTPUT_PRESETS.shorts.maxDuration);
  const [preset, setPreset] = useState<EditorialPresetId>('youth');
  const [instructions, setInstructions] = useState(YOUTH_CONTEXT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        additional_instructions: buildAnalysisInstructions({
          outputKind,
          sourceKind,
          styleText: instructions,
        }),
      });
      setJob(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el análisis');
    } finally {
      setBusy(false);
    }
  }, [projectId, maxReels, minDuration, maxDuration, instructions, outputKind, sourceKind]);

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

  const active = isActive(job);
  const percent = job ? Math.round(job.progress * 100) : 0;
  const stageLabel = job?.stage ? (STAGE_LABELS[job.stage] ?? job.stage) : '—';
  const candidates = job?.candidates ?? [];

  return (
    <section className="card analysis-panel">
      <div className="reel-editor__section-header">
        <h2>Análisis editorial asistido</h2>
        {job && (
          <span className={`badge badge--${job.status}`}>
            {STAGE_LABELS[job.status] ?? job.status}
          </span>
        )}
      </div>

      <p className="muted">
        Aquí solo se analiza: nada entra al Reel hasta que lo elijas. Los candidatos aparecen
        después en el editor, en Archivos, con duración y «Añadir al Reel». El paso anterior (
        {sourceKind === 'full_service' ? 'culto completo' : 'solo predicación'}) ya le dice a la IA
        qué fuente usar.
      </p>

      {provider && (
        <p className="muted">
          Motor de análisis:{' '}
          <strong>{provider.active === 'mock' ? 'local' : provider.active}</strong>
          {provider.gemini_configured ? ` · ${provider.gemini_model}` : ''}
        </p>
      )}

      {!hasTranscript && (
        <p className="muted">Importa o genera una transcripción sincronizada para analizar.</p>
      )}

      {hasTranscript && (
        <>
          <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
            <span>Qué debe proponer la IA</span>
            <div className="source-toggle" role="radiogroup" aria-label="Formato de análisis">
              {(Object.keys(ANALYSIS_OUTPUT_PRESETS) as AnalysisOutputKind[]).map((kind) => {
                const presetInfo = ANALYSIS_OUTPUT_PRESETS[kind];
                return (
                  <label className="source-toggle__option" key={kind}>
                    <input
                      type="radio"
                      name="analysis-output"
                      value={kind}
                      checked={outputKind === kind}
                      disabled={active || busy}
                      onChange={() => {
                        setOutputKind(kind);
                        setMinDuration(presetInfo.minDuration);
                        setMaxDuration(presetInfo.maxDuration);
                      }}
                    />
                    <span>
                      {presetInfo.label}
                      <small>{presetInfo.hint}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="transcript-toolbar analysis-panel__params">
            <label className="field">
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
            <label className="field">
              <span>Duración mín.</span>
              <div className="field__with-unit">
                <input
                  type="number"
                min={5}
                max={600}
                  value={minDuration}
                  disabled={active || busy}
                  onChange={(e) => setMinDuration(Number(e.target.value))}
                />
                <span className="muted">s</span>
              </div>
            </label>
            <label className="field">
              <span>Duración máx.</span>
              <div className="field__with-unit">
                <input
                  type="number"
                min={10}
                max={900}
                  value={maxDuration}
                  disabled={active || busy}
                  onChange={(e) => setMaxDuration(Number(e.target.value))}
                />
                <span className="muted">s</span>
              </div>
            </label>
          </div>

          <label className="field">
            <span>Estilo de clip</span>
            <select
              value={preset}
              disabled={active || busy}
              onChange={(event) => {
                const next = event.target.value as EditorialPresetId;
                setPreset(next);
                const match = EDITORIAL_PRESETS.find((item) => item.id === next);
                if (match && match.text) setInstructions(match.text);
              }}
            >
              {EDITORIAL_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Contexto para la IA</span>
            <textarea
              rows={5}
              value={instructions}
              disabled={active || busy}
              placeholder="Puedes añadir o quitar instrucciones: tono, qué evitar, cómo cerrar…"
              onChange={(e) => {
                setPreset('custom');
                setInstructions(e.target.value);
              }}
            />
            <small className="muted">
              Cambia al elegir el estilo. Edítalo libremente; eso es lo que recibe el modelo.
            </small>
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
              <h3>Propuestas del análisis</h3>
              <p className="muted">
                No se eligen aquí. Ábrelas en el editor, en Archivos, y añádelas al Reel.
              </p>
              <ol className="analysis-candidates__list">
                {candidates.map((candidate) => (
                  <li key={candidate.id} className="analysis-candidate">
                    <div className="analysis-candidate__header">
                      <strong>
                        {candidate.rank + 1}. {candidate.title}
                      </strong>
                    </div>
                    <p className="muted">
                      Score {candidate.editorial_score.toFixed(1)} ·{' '}
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
                        </li>
                      ))}
                    </ul>
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
