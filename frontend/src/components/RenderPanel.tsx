import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import { validateReelCoherence } from '../api/coherence';
import { estimateExportSize, listExportProfiles } from '../api/exportProfiles';
import {
  cancelRenderJob,
  deleteRenderJob,
  getLatestRender,
  getRenderJob,
  listRenders,
  renderOutputUrl,
  renderReportUrl,
  revealRenderOutput,
  startRender,
} from '../api/renders';
import type { CoherenceReport } from '../types/coherence';
import type { ExportProfile, ExportQuality, SizeEstimate } from '../types/exportProfile';
import type { AspectRatio, FramingMode, ReelSegment } from '../types/reel';
import type { RenderJob, RenderLayout } from '../types/render';
import { ACTIVE_RENDER_STATUSES } from '../types/render';
import { groupCoherenceIssues } from '../utils/coherenceGroups';
import { EXPORT_PROFILES_CHANGED_EVENT, openAppPanel } from '../utils/appPanels';
import { formatDuration } from '../utils/format';
import { nativeVideoControlProps } from '../utils/nativeMediaControls';
import { previewTimelineIdentity } from '../utils/reelPreview';
import { ConfirmDialog } from './ConfirmDialog';
import { ProgressBar } from './ProgressBar';

interface RenderPanelProps {
  projectId: string;
  reelId: string;
  reelAspectRatio: AspectRatio;
  segments: ReelSegment[];
  audioOffsetMs: number;
  /** Flush unsaved fragment captions (and similar) before starting FFmpeg. */
  onBeforeStart?: () => Promise<void>;
  /** Jump to Cuts when the server refuses a blocked join. */
  onGoToCuts?: () => void;
  framingMode?: FramingMode | string;
  subtitleEnabled?: boolean;
  normalizeLoudness?: boolean;
}

const POLL_INTERVAL_MS = 1500;

const QUALITY_OPTIONS: { value: ExportQuality; label: string }[] = [
  { value: 'draft', label: 'Borrador' },
  { value: 'standard', label: 'Estándar' },
  { value: 'high', label: 'Alta' },
];

const STAGE_LABELS: Record<string, string> = {
  queued: 'En cola',
  preparing: 'Preparando',
  end_card: 'Generando pantalla final',
  encoding: 'Codificando',
  verifying: 'Verificando (FFprobe)',
  finalizing: 'Finalizando',
  completed: 'Completado',
  cancelling: 'Cancelando',
  cancelled: 'Cancelado',
  failed: 'Error',
};

function isActive(job: RenderJob | null): boolean {
  return job != null && ACTIVE_RENDER_STATUSES.includes(job.status);
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function crfForProfile(profile: ExportProfile, quality: ExportQuality): number {
  if (quality === 'draft') return profile.crf_draft;
  if (quality === 'high') return profile.crf_high;
  return profile.crf_standard;
}

function profileSettingIssues(
  profile: ExportProfile | null,
  durationSeconds: number | null,
  reelAspectRatio: AspectRatio,
): string[] {
  if (!profile) return [];
  const issues: string[] = [];
  if (durationSeconds != null && durationSeconds > profile.max_duration_seconds + 0.5) {
    issues.push(
      `Dura ${formatDuration(durationSeconds)} y ${profile.name} admite como máximo ${profile.max_duration_seconds} s.`,
    );
  }
  if (profile.aspect_ratio !== reelAspectRatio) {
    issues.push(`El Reel es ${reelAspectRatio} y ${profile.name} es ${profile.aspect_ratio}.`);
  }
  if (
    profile.fragmentation_enabled &&
    profile.fragment_max_seconds != null &&
    durationSeconds != null &&
    durationSeconds > profile.fragment_max_seconds + 0.5
  ) {
    issues.push(
      `WhatsApp sugiere trozos de ${profile.fragment_max_seconds} s y este video dura ${formatDuration(durationSeconds)}.`,
    );
  }
  return issues;
}

export function RenderPanel({
  projectId,
  reelId,
  reelAspectRatio,
  segments,
  audioOffsetMs: _audioOffsetMs,
  onBeforeStart,
  onGoToCuts,
  framingMode = 'center_crop',
  subtitleEnabled = true,
  normalizeLoudness = true,
}: RenderPanelProps) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [history, setHistory] = useState<RenderJob[]>([]);
  const [profiles, setProfiles] = useState<ExportProfile[]>([]);
  const [profileId, setProfileId] = useState<string>('');
  const [quality, setQuality] = useState<ExportQuality>('standard');
  const [crf, setCrf] = useState<number>(23);
  const [estimate, setEstimate] = useState<SizeEstimate | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coherence, setCoherence] = useState<CoherenceReport | null>(null);
  const [pendingDeleteRender, setPendingDeleteRender] = useState<RenderJob | null>(null);
  const previousReelRef = useRef<string>(reelId);
  const segmentCount = segments.length;
  const cutsIdentity = previewTimelineIdentity(reelId, segments);

  const matchingProfiles = useMemo(
    () => profiles.filter((item) => item.aspect_ratio === reelAspectRatio),
    [profiles, reelAspectRatio],
  );
  const visibleProfiles = matchingProfiles.length > 0 ? matchingProfiles : profiles;
  const selectedProfile = useMemo(
    () => visibleProfiles.find((item) => item.id === profileId) ?? visibleProfiles[0] ?? null,
    [visibleProfiles, profileId],
  );

  useEffect(() => {
    if (visibleProfiles.length === 0) return;
    if (visibleProfiles.some((item) => item.id === profileId)) return;
    setProfileId(visibleProfiles[0].id);
  }, [visibleProfiles, profileId]);

  useEffect(() => {
    let cancelled = false;
    listExportProfiles()
      .then((data) => {
        if (cancelled) return;
        setProfiles(data.items);
        const matching = data.items.filter((item) => item.aspect_ratio === reelAspectRatio);
        const preferred =
          matching.find((item) => item.slug === 'youtube-short') ??
          matching[0] ??
          data.items.find((item) => item.slug === 'youtube-short') ??
          data.items[0];
        if (preferred) {
          setProfileId((current) => current || preferred.id);
          setCrf(crfForProfile(preferred, 'standard'));
        }
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function reloadProfiles() {
      listExportProfiles()
        .then((data) => {
          setProfiles(data.items);
        })
        .catch(() => {});
    }
    window.addEventListener(EXPORT_PROFILES_CHANGED_EVENT, reloadProfiles);
    return () => window.removeEventListener(EXPORT_PROFILES_CHANGED_EVENT, reloadProfiles);
  }, []);

  useEffect(() => {
    if (!selectedProfile) return;
    setCrf(crfForProfile(selectedProfile, quality));
  }, [selectedProfile, quality]);

  useEffect(() => {
    if (segmentCount === 0) {
      setCoherence(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      validateReelCoherence(
        projectId,
        reelId,
        {
          include_ai_review: false,
          include_media_probes: false,
        },
        controller.signal,
      )
        .then((report) => {
          if (!controller.signal.aborted) {
            setCoherence(report);
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof ApiError && err.code === 'request_cancelled') return;
          if (!controller.signal.aborted) setCoherence(null);
        });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, reelId, segmentCount, cutsIdentity]);

  useEffect(() => {
    let cancelled = false;
    if (previousReelRef.current !== reelId) {
      previousReelRef.current = reelId;
      setJob(null);
      setHistory([]);
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
    listRenders(projectId, reelId)
      .then((data) => {
        if (!cancelled) setHistory(data.items);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
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
        .then((next) => {
          setJob(next);
          if (!ACTIVE_RENDER_STATUSES.includes(next.status)) {
            void listRenders(projectId, reelId).then((data) => setHistory(data.items));
          }
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'No se pudo actualizar el estado');
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [job, projectId, reelId]);

  useEffect(() => {
    if (!profileId || segmentCount === 0) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    estimateExportSize(projectId, reelId, {
      profile_id: profileId,
      quality,
      crf,
    })
      .then((data) => {
        if (!cancelled) setEstimate(data);
      })
      .catch(() => {
        if (!cancelled) setEstimate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reelId, profileId, quality, crf, segmentCount, segments.length]);

  const handleStart = useCallback(
    async (options: { acknowledgeCoherence?: boolean } = {}) => {
      if (!profileId) {
        setError('Selecciona un perfil de exportación.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        if (onBeforeStart) {
          await onBeforeStart();
        }
        const started = await startRender(projectId, reelId, {
          profile_id: profileId,
          quality,
          crf,
          aspect_ratio: selectedProfile?.aspect_ratio ?? reelAspectRatio,
          layout: (framingMode as RenderLayout) || 'center_crop',
          normalize_loudness: normalizeLoudness,
          burn_subtitles: subtitleEnabled,
          acknowledge_coherence: options.acknowledgeCoherence ?? true,
        });
        setJob(started);
        const data = await listRenders(projectId, reelId);
        setHistory(data.items);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'No se pudo iniciar el render';
        setError(message);
        if (err instanceof ApiError && err.code === 'coherence_blocked' && onGoToCuts) {
          // Keep the error; Cuts has the join review.
        }
      } finally {
        setBusy(false);
      }
    },
    [
      projectId,
      reelId,
      profileId,
      quality,
      crf,
      selectedProfile,
      reelAspectRatio,
      framingMode,
      normalizeLoudness,
      subtitleEnabled,
      onBeforeStart,
      onGoToCuts,
    ],
  );

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

  const handleReveal = useCallback(async () => {
    if (!job || job.status !== 'completed') return;
    setBusy(true);
    try {
      await revealRenderOutput(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la carpeta');
    } finally {
      setBusy(false);
    }
  }, [job]);

  const handleDeleteRender = useCallback(async () => {
    if (!pendingDeleteRender) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRenderJob(pendingDeleteRender.id);
      const data = await listRenders(projectId, reelId);
      setHistory(data.items);
      if (job?.id === pendingDeleteRender.id) {
        setJob(data.items[0] ?? null);
      }
      setPendingDeleteRender(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el render');
    } finally {
      setBusy(false);
    }
  }, [job?.id, pendingDeleteRender, projectId, reelId]);

  const active = isActive(job);
  const percent = job ? Math.round(job.progress * 100) : 0;
  const stageLabel = job?.stage ? (STAGE_LABELS[job.stage] ?? job.stage) : '—';
  const canRender = segmentCount > 0 && !!profileId;
  const openIssues = (coherence?.issues ?? []).filter((issue) => !issue.dismissed);
  const groupedOpenIssues = groupCoherenceIssues(openIssues);
  const settingIssues = useMemo(
    () =>
      profileSettingIssues(
        selectedProfile,
        estimate?.duration_seconds ?? null,
        reelAspectRatio,
      ),
    [selectedProfile, estimate?.duration_seconds, reelAspectRatio],
  );

  return (
    <div className="render-panel">
      {estimate ? (
        <div className="render-panel__estimate">
          <strong>Estimación de tamaño</strong>
          <p>
            ~{formatSize(estimate.estimated_bytes)} · {formatDuration(estimate.duration_seconds)}
          </p>
        </div>
      ) : null}

      <div className="reel-editor__section-header">
        <h4>Exportar Reel</h4>
        <div className="button-stack">
          {job && (
            <span className={`badge badge--${job.status}`}>
              {STAGE_LABELS[job.status] ?? job.status}
            </span>
          )}
          {!active && (
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={busy || !canRender}
              title={
                canRender
                  ? 'Generar el archivo MP4 del Reel'
                  : 'Añade fragmentos y elige un perfil'
              }
            >
              {busy ? 'Preparando exportación…' : 'Exportar Reel a MP4'}
            </button>
          )}
        </div>
      </div>

      {!canRender && segmentCount === 0 && (
        <p className="muted">Añade al menos un fragmento al Reel para poder exportarlo.</p>
      )}

      {segmentCount > 0 && (
        <>
          {groupedOpenIssues.length > 0 ? (
            <div className="render-panel__block-notice" aria-live="polite">
              <ul className="render-panel__coherence-issues">
                {groupedOpenIssues.slice(0, 4).map((group) => (
                  <li key={group.key}>{group.issues[0].message}</li>
                ))}
                {groupedOpenIssues.length > 4 ? (
                  <li>… y {groupedOpenIssues.length - 4} más en Cortes.</li>
                ) : null}
              </ul>
              {onGoToCuts ? (
                <button type="button" className="button button--secondary" onClick={onGoToCuts}>
                  Revisar en Cortes
                </button>
              ) : null}
            </div>
          ) : null}

          {settingIssues.length > 0 ? (
            <div className="render-panel__block-notice" aria-live="polite">
              <ul className="render-panel__coherence-issues">
                {settingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => openAppPanel('settings')}
              >
                Revisar configuración
              </button>
            </div>
          ) : null}

          <div className="transcript-toolbar">
            <label className="field field--inline">
              <span>Perfil</span>
              <select
                value={selectedProfile?.id ?? profileId}
                onChange={(e) => setProfileId(e.target.value)}
                disabled={active || busy}
              >
                {visibleProfiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.aspect_ratio !== reelAspectRatio ? ` (${item.aspect_ratio})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline">
              <span>Calidad</span>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as ExportQuality)}
                disabled={active || busy}
              >
                {QUALITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--inline">
              <span>CRF</span>
              <input
                type="number"
                min={14}
                max={32}
                value={crf}
                disabled={active || busy}
                onChange={(e) => setCrf(Number(e.target.value) || 23)}
              />
            </label>
            <div className="button-stack">
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

          {active && job && (
            <div className="transcription-progress">
              <ProgressBar label={stageLabel} percent={percent} />
              <p className="muted">
                {formatDuration(job.processed_seconds)} / {formatDuration(job.total_seconds)}
                {job.speed ? ` · ${job.speed.toFixed(2)}×` : ''}
                {job.width && job.height ? ` · ${job.width}×${job.height}` : ''}
                {job.profile_name ? ` · ${job.profile_name}` : ''}
              </p>
            </div>
          )}

          {job?.status === 'completed' && job.output_filename && (
            <div className="render-result">
              <video
                className="render-result__video"
                src={renderOutputUrl(job.id)}
                {...nativeVideoControlProps}
                preload="metadata"
              />
              <div className="render-result__meta">
                <p>
                  <strong>{job.output_filename}</strong>
                </p>
                <ul className="render-result__facts">
                  <li>Duración: {formatDuration(job.total_seconds)}</li>
                  <li>
                    Resolución: {job.width}×{job.height}
                    {job.fps ? ` · ${job.fps} fps` : ''}
                  </li>
                  <li>Tamaño: {formatSize(job.output_size_bytes)}</li>
                  <li>Fecha: {formatDate(job.finished_at ?? job.created_at)}</li>
                  <li>
                    Perfil: {job.profile_name ?? job.profile_slug ?? '—'}
                    {job.quality ? ` · ${job.quality}` : ''}
                    {job.crf != null ? ` · CRF ${job.crf}` : ''}
                  </li>
                  <li>Estado: {STAGE_LABELS[job.status] ?? job.status}</li>
                  {job.sha256 && (
                    <li className="muted">
                      SHA-256: <code>{job.sha256.slice(0, 16)}…</code>
                    </li>
                  )}
                  <li className="muted">Publicación: local (sin auto-publicar)</li>
                </ul>
                <div className="button-stack">
                  <a
                    className="button-link"
                    href={renderOutputUrl(job.id, true)}
                    download={job.output_filename}
                  >
                    Descargar MP4
                  </a>
                  <button
                    type="button"
                    className="button--ghost"
                    onClick={() => void handleReveal()}
                  >
                    Abrir carpeta
                  </button>
                  {job.report_filename && (
                    <a className="button-link" href={renderReportUrl(job.id)} download>
                      Reporte JSON
                    </a>
                  )}
                  <button
                    type="button"
                    className="button button--danger button--inline"
                    onClick={() => setPendingDeleteRender(job)}
                  >
                    Eliminar render
                  </button>
                </div>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="render-panel__history">
              <h5>Historial de renders</h5>
              <table className="render-panel__table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Perfil</th>
                    <th>Duración</th>
                    <th>Resolución</th>
                    <th>Tamaño</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDate(item.finished_at ?? item.created_at)}</td>
                      <td>{item.profile_name ?? item.profile_slug ?? '—'}</td>
                      <td>{formatDuration(item.total_seconds)}</td>
                      <td>{item.width && item.height ? `${item.width}×${item.height}` : '—'}</td>
                      <td>{formatSize(item.output_size_bytes)}</td>
                      <td>{STAGE_LABELS[item.status] ?? item.status}</td>
                      <td>
                        {item.status === 'completed' && item.output_filename ? (
                          <div className="button-stack">
                            <a
                              className="button-link"
                              href={renderOutputUrl(item.id, true)}
                              download={item.output_filename}
                            >
                              Descargar MP4
                            </a>
                            <button
                              type="button"
                              className="button button--danger button--inline"
                              onClick={() => setPendingDeleteRender(item)}
                            >
                              Eliminar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="button button--danger button--inline"
                            disabled={ACTIVE_RENDER_STATUSES.includes(item.status)}
                            onClick={() => setPendingDeleteRender(item)}
                          >
                            Eliminar registro
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {pendingDeleteRender && (
        <ConfirmDialog
          title="Eliminar render"
          message={`Se borrarán «${pendingDeleteRender.output_filename ?? 'este registro'}» y su reporte del disco. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar render"
          busy={busy}
          onConfirm={() => void handleDeleteRender()}
          onCancel={() => !busy && setPendingDeleteRender(null)}
        />
      )}
    </div>
  );
}
