import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getBackgroundMusicMeters } from '../api/backgroundMusic';
import { ApiError } from '../api/client';
import {
  estimateExportSize,
  listExportProfiles,
  updateExportProfile,
} from '../api/exportProfiles';
import {
  cancelRenderJob,
  getLatestRender,
  getRenderJob,
  listRenders,
  renderOutputUrl,
  renderReportUrl,
  revealRenderOutput,
  startRender,
} from '../api/renders';
import type { BackgroundMusicMeters } from '../types/backgroundMusic';
import type { CoherenceReport } from '../types/coherence';
import type { ExportProfile, ExportQuality, SizeEstimate } from '../types/exportProfile';
import type { AspectRatio, Reel, ReelSegment } from '../types/reel';
import type { RenderJob, RenderLayout } from '../types/render';
import { ACTIVE_RENDER_STATUSES } from '../types/render';
import { formatDuration } from '../utils/format';
import { CoherencePanel } from './CoherencePanel';
import { ProgressBar } from './ProgressBar';

interface RenderPanelProps {
  projectId: string;
  reelId: string;
  reelAspectRatio: AspectRatio;
  segments: ReelSegment[];
  onReelChange: (reel: Reel) => void;
}

const POLL_INTERVAL_MS = 1500;

const LAYOUT_OPTIONS: { value: RenderLayout; label: string }[] = [
  { value: 'auto_track', label: 'Seguimiento automático' },
  { value: 'center_crop', label: 'Recorte centrado' },
  { value: 'blurred_background', label: 'Fondo desenfocado' },
  { value: 'manual', label: 'Posición manual' },
];

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

export function RenderPanel({
  projectId,
  reelId,
  reelAspectRatio,
  segments,
  onReelChange,
}: RenderPanelProps) {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [history, setHistory] = useState<RenderJob[]>([]);
  const [profiles, setProfiles] = useState<ExportProfile[]>([]);
  const [profileId, setProfileId] = useState<string>('');
  const [quality, setQuality] = useState<ExportQuality>('standard');
  const [crf, setCrf] = useState<number>(23);
  const [layout, setLayout] = useState<RenderLayout>('center_crop');
  const [normalizeLoudness, setNormalizeLoudness] = useState(true);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [estimate, setEstimate] = useState<SizeEstimate | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coherence, setCoherence] = useState<CoherenceReport | null>(null);
  const [meters, setMeters] = useState<BackgroundMusicMeters | null>(null);
  const previousReelRef = useRef<string>(reelId);
  const segmentCount = segments.length;

  const selectedProfile = useMemo(
    () => profiles.find((item) => item.id === profileId) ?? null,
    [profiles, profileId],
  );

  useEffect(() => {
    listExportProfiles()
      .then((data) => {
        setProfiles(data.items);
        const preferred =
          data.items.find((item) => item.slug === 'youtube-short') ?? data.items[0];
        if (preferred) {
          setProfileId((current) => current || preferred.id);
          setCrf(crfForProfile(preferred, 'standard'));
        }
      })
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    if (!selectedProfile) return;
    setCrf(crfForProfile(selectedProfile, quality));
  }, [selectedProfile, quality]);

  useEffect(() => {
    let cancelled = false;
    getBackgroundMusicMeters(projectId)
      .then((data) => {
        if (!cancelled) setMeters(data);
      })
      .catch(() => {
        if (!cancelled) setMeters(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, job?.status]);

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

  const handleStart = useCallback(async () => {
    if (coherence && !coherence.can_render) {
      setError(
        coherence.severity === 'blocked'
          ? 'Corrige los problemas bloqueantes de coherencia antes de renderizar.'
          : 'Revisa o ignora las advertencias de unión antes de renderizar.',
      );
      return;
    }
    if (!profileId) {
      setError('Selecciona un perfil de exportación.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await startRender(projectId, reelId, {
        profile_id: profileId,
        quality,
        crf,
        aspect_ratio: selectedProfile?.aspect_ratio ?? reelAspectRatio,
        layout,
        normalize_loudness: normalizeLoudness,
        burn_subtitles: burnSubtitles,
      });
      setJob(started);
      const data = await listRenders(projectId, reelId);
      setHistory(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el render');
    } finally {
      setBusy(false);
    }
  }, [
    projectId,
    reelId,
    profileId,
    quality,
    crf,
    selectedProfile,
    reelAspectRatio,
    layout,
    normalizeLoudness,
    burnSubtitles,
    coherence,
  ]);

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

  const handleSaveProfile = useCallback(async () => {
    if (!selectedProfile) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateExportProfile(selectedProfile.id, {
        max_duration_seconds: selectedProfile.max_duration_seconds,
        fps_mode: selectedProfile.fps_mode,
        safe_top: selectedProfile.safe_top,
        safe_bottom: selectedProfile.safe_bottom,
        crf_draft: selectedProfile.crf_draft,
        crf_standard: selectedProfile.crf_standard,
        crf_high: selectedProfile.crf_high,
        fragmentation_enabled: selectedProfile.fragmentation_enabled,
        fragment_max_seconds: selectedProfile.fragment_max_seconds,
        prefer_small_file: selectedProfile.prefer_small_file,
      });
      setProfiles((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setCrf(crfForProfile(updated, quality));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el perfil');
    } finally {
      setBusy(false);
    }
  }, [selectedProfile, quality]);

  const patchSelected = (patch: Partial<ExportProfile>) => {
    if (!selectedProfile) return;
    setProfiles((items) =>
      items.map((item) => (item.id === selectedProfile.id ? { ...item, ...patch } : item)),
    );
  };

  const active = isActive(job);
  const percent = job ? Math.round(job.progress * 100) : 0;
  const stageLabel = job?.stage ? (STAGE_LABELS[job.stage] ?? job.stage) : '—';
  const canRender = segmentCount > 0 && coherence != null && coherence.can_render && !!profileId;

  return (
    <div className="render-panel">
      <CoherencePanel
        projectId={projectId}
        reelId={reelId}
        segments={segments}
        onReelChange={onReelChange}
        onReportChange={setCoherence}
      />

      <div className="reel-editor__section-header">
        <h4>Exportar video (perfiles)</h4>
        {job && (
          <span className={`badge badge--${job.status}`}>
            {STAGE_LABELS[job.status] ?? job.status}
          </span>
        )}
      </div>

      <p className="muted">
        Exportación local únicamente — sin publicación automática. MP4 H.264 + AAC, verificada con
        FFprobe al terminar.
      </p>

      <p className="error" role="note">
        Responsabilidad editorial: un Short/Reel con cortes no consecutivos puede alterar el
        sentido del sermón. Revisa la unión, los subtítulos tras varios segmentos y el contenido
        completo antes de publicar. La validación de coherencia bloquea solo problemas graves;
        las advertencias se pueden ignorar conscientemente.
      </p>

      {!canRender && segmentCount === 0 && (
        <p className="muted">Añade al menos un fragmento al Reel para poder exportarlo.</p>
      )}

      {segmentCount > 0 && coherence && !coherence.can_render && (
        <p className="error">
          Resuelve o ignora las advertencias de la validación de unión antes del render final.
        </p>
      )}

      {segmentCount > 0 && (
        <>
          <div className="transcript-toolbar">
            <label className="field field--inline">
              <span>Perfil</span>
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                disabled={active || busy}
              >
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
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
            <label className="field field--inline field--checkbox">
              <input
                type="checkbox"
                checked={burnSubtitles}
                onChange={(e) => setBurnSubtitles(e.target.checked)}
                disabled={active || busy}
              />
              <span>Quemar subtítulos</span>
            </label>
            <div className="button-stack">
              {!active && (
                <button type="button" onClick={() => void handleStart()} disabled={busy || !canRender}>
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

          {selectedProfile && (
            <p className="muted">
              {selectedProfile.width}×{selectedProfile.height} · {selectedProfile.aspect_ratio} ·
              máx. {selectedProfile.max_duration_seconds}s · FPS{' '}
              {selectedProfile.fps_mode === 'fixed_30' ? '30' : 'original'} · área segura arriba{' '}
              {Math.round(selectedProfile.safe_top * 100)}% / abajo{' '}
              {Math.round(selectedProfile.safe_bottom * 100)}%
              {selectedProfile.description ? ` — ${selectedProfile.description}` : ''}
            </p>
          )}

          <button
            type="button"
            className="button--ghost"
            onClick={() => setShowProfileEdit((value) => !value)}
          >
            {showProfileEdit ? 'Ocultar edición de perfil' : 'Editar perfil'}
          </button>

          {showProfileEdit && selectedProfile && (
            <div className="render-panel__profile-edit">
              <label className="field">
                <span>Máx. duración (s) — Shorts: 60 o 180</span>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={selectedProfile.max_duration_seconds}
                  disabled={busy}
                  onChange={(e) =>
                    patchSelected({ max_duration_seconds: Number(e.target.value) || 60 })
                  }
                />
              </label>
              <label className="field">
                <span>FPS</span>
                <select
                  value={selectedProfile.fps_mode}
                  disabled={busy}
                  onChange={(e) =>
                    patchSelected({ fps_mode: e.target.value as ExportProfile['fps_mode'] })
                  }
                >
                  <option value="original">Igual al original</option>
                  <option value="fixed_30">Fijo 30</option>
                </select>
              </label>
              <label className="field">
                <span>Safe top</span>
                <input
                  type="number"
                  min={0}
                  max={0.4}
                  step={0.01}
                  value={selectedProfile.safe_top}
                  disabled={busy}
                  onChange={(e) => patchSelected({ safe_top: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Safe bottom</span>
                <input
                  type="number"
                  min={0}
                  max={0.4}
                  step={0.01}
                  value={selectedProfile.safe_bottom}
                  disabled={busy}
                  onChange={(e) => patchSelected({ safe_bottom: Number(e.target.value) })}
                />
              </label>
              <label className="field field--checkbox">
                <input
                  type="checkbox"
                  checked={selectedProfile.fragmentation_enabled}
                  disabled={busy}
                  onChange={(e) => patchSelected({ fragmentation_enabled: e.target.checked })}
                />
                <span>Fragmentación opcional (WhatsApp)</span>
              </label>
              <button type="button" disabled={busy} onClick={() => void handleSaveProfile()}>
                Guardar perfil
              </button>
            </div>
          )}

          {estimate && (
            <div className="render-panel__estimate">
              <strong>Estimación de tamaño</strong>
              <p className="muted">
                ~{estimate.estimated_mb} MB ({formatSize(estimate.estimated_bytes)}) · CRF{' '}
                {estimate.crf} · AAC {estimate.audio_bitrate_k} kbps · ~
                {formatDuration(estimate.duration_seconds)}
              </p>
              <p className="muted">{estimate.note}</p>
              {estimate.fragmentation_note && (
                <p className="muted">{estimate.fragmentation_note}</p>
              )}
            </div>
          )}

          {meters && (
            <div className="render-panel__meters" aria-live="polite">
              <strong>Medidores de audio (antes de exportar)</strong>
              <p className="muted">
                {meters.normalize_note} · {meters.voice_priority_note}
                {meters.enabled
                  ? ` · Música ~${Math.abs(meters.estimated_music_under_voice_db)} dB bajo la voz`
                  : ''}
                {' · '}
                Clipping: {meters.clipping_risk}
              </p>
              <p className="muted render-panel__rights">{meters.rights_warning}</p>
            </div>
          )}

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
                controls
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
                  <button type="button" className="button--ghost" onClick={() => void handleReveal()}>
                    Abrir carpeta
                  </button>
                  {job.report_filename && (
                    <a className="button-link" href={renderReportUrl(job.id)} download>
                      Reporte JSON
                    </a>
                  )}
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
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDate(item.finished_at ?? item.created_at)}</td>
                      <td>{item.profile_name ?? item.profile_slug ?? '—'}</td>
                      <td>{formatDuration(item.total_seconds)}</td>
                      <td>
                        {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                      </td>
                      <td>{formatSize(item.output_size_bytes)}</td>
                      <td>{STAGE_LABELS[item.status] ?? item.status}</td>
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
    </div>
  );
}
