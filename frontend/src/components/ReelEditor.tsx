import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import {
  addReelSegment,
  createReel,
  createReelFromTranscript,
  deleteReel,
  listReels,
  removeReelSegment,
  reorderReelSegments,
  updateReel,
  updateReelSegment,
} from '../api/reels';
import { getTranscript, projectVideoUrl } from '../api/transcripts';
import type { AspectRatio, Reel, ReelSegment, TransitionType } from '../types/reel';
import type { TranscriptSegment } from '../types/transcript';
import { formatDuration, formatTimecode } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { CutSuggestionMarkers, CutSuggestionsPanel } from './CutSuggestionsPanel';
import { BackgroundMusicPanel } from './BackgroundMusicPanel';
import { EndCardPanel } from './EndCardPanel';
import { FramingPanel } from './FramingPanel';
import { RenderPanel } from './RenderPanel';
import { SubtitlePanel } from './SubtitlePanel';
import type { CutSuggestion, CutSuggestionsReport } from '../types/cutSuggestions';
import {
  acceptCutSuggestion,
  rejectCutSuggestion,
} from '../api/cutSuggestions';

interface ReelEditorProps {
  projectId: string;
  hasVideo: boolean;
  hasCover: boolean;
  videoDuration: number | null;
}

const ASPECT_OPTIONS: AspectRatio[] = ['9:16', '1:1', '16:9'];
const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'hard_cut', label: 'Corte duro' },
  { value: 'short_crossfade', label: 'Fundido corto' },
  { value: 'dip_to_black', label: 'Fundido a negro' },
];

const ADJUST_STEPS = [-1, -0.1, 0.1, 1] as const;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function defaultTransitionMs(type: TransitionType): number {
  if (type === 'hard_cut') return 0;
  if (type === 'short_crossfade') return 250;
  return 400;
}

function gapSeconds(prev: ReelSegment, next: ReelSegment): number {
  return next.source_start_seconds - prev.source_end_seconds;
}

export function ReelEditor({ projectId, hasVideo, hasCover, videoDuration }: ReelEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [activeReelId, setActiveReelId] = useState<string | null>(null);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [selectedTranscriptIds, setSelectedTranscriptIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState('Nuevo Reel');
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [confirmDeleteReel, setConfirmDeleteReel] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [sourceTime, setSourceTime] = useState<number | null>(null);
  const [cutReport, setCutReport] = useState<CutSuggestionsReport | null>(null);
  const [cutBusy, setCutBusy] = useState(false);
  const previewIndexRef = useRef(0);
  const previewingRef = useRef(false);

  const activeReel = useMemo(
    () => reels.find((reel) => reel.id === activeReelId) ?? null,
    [reels, activeReelId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [reelList, transcript] = await Promise.all([
        listReels(projectId),
        getTranscript(projectId).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
      ]);
      setReels(reelList.items);
      setTranscriptSegments(transcript?.segments ?? []);
      setError(null);
      setActiveReelId((current) => {
        if (current && reelList.items.some((r) => r.id === current)) return current;
        return reelList.items[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los Reels');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (activeReel) setTitleDraft(activeReel.title);
  }, [activeReel?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only sync on reel switch

  function replaceReel(updated: Reel) {
    setReels((prev) => {
      const next = prev.map((reel) => (reel.id === updated.id ? updated : reel));
      if (!next.some((reel) => reel.id === updated.id)) next.unshift(updated);
      return next;
    });
    setActiveReelId(updated.id);
  }

  async function handleAcceptCut(suggestion: CutSuggestion) {
    if (!activeReel) return;
    setCutBusy(true);
    setError(null);
    try {
      const result = await acceptCutSuggestion(projectId, activeReel.id, suggestion.id);
      replaceReel(result.reel);
      setCutReport(result.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar el corte');
    } finally {
      setCutBusy(false);
    }
  }

  async function handleRejectCut(suggestion: CutSuggestion) {
    if (!activeReel) return;
    setCutBusy(true);
    setError(null);
    try {
      const result = await rejectCutSuggestion(projectId, activeReel.id, suggestion.id);
      setCutReport(result.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar el corte');
    } finally {
      setCutBusy(false);
    }
  }

  function toggleTranscript(id: string) {
    setSelectedTranscriptIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleCreateFromSelection() {
    if (selectedTranscriptIds.length === 0) {
      setError('Selecciona uno o más segmentos de la transcripción.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createReelFromTranscript(projectId, {
        title: titleDraft.trim() || 'Nuevo Reel',
        transcript_segment_ids: selectedTranscriptIds,
        aspect_ratio: aspect,
      });
      replaceReel(created);
      setSelectedTranscriptIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el Reel');
    } finally {
      setBusy(false);
    }
  }

  async function handleAppendFromSelection() {
    if (!activeReel) {
      setError('Crea o selecciona un Reel primero.');
      return;
    }
    if (selectedTranscriptIds.length === 0) {
      setError('Selecciona uno o más segmentos de la transcripción.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await createReelFromTranscript(projectId, {
        title: activeReel.title,
        transcript_segment_ids: selectedTranscriptIds,
        aspect_ratio: activeReel.aspect_ratio,
        reel_id: activeReel.id,
      });
      replaceReel(updated);
      setSelectedTranscriptIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir el fragmento');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateEmpty() {
    setBusy(true);
    setError(null);
    try {
      const created = await createReel(projectId, {
        title: titleDraft.trim() || 'Nuevo Reel',
        aspect_ratio: aspect,
        segments: [],
      });
      replaceReel(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el Reel');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddManualFragment() {
    if (!activeReel) return;
    const lastSeg = activeReel.segments[activeReel.segments.length - 1];
    const start = lastSeg?.source_end_seconds ?? 0;
    const end = Math.min(videoDuration ?? start + 5, start + 5);
    if (end - start < 0.1) {
      setError('No queda margen en el video para otro fragmento.');
      return;
    }
    setBusy(true);
    try {
      const updated = await addReelSegment(projectId, activeReel.id, {
        source_start_seconds: round3(start + 1),
        source_end_seconds: round3(Math.min(end + 1, videoDuration ?? end + 1)),
        transition_type: 'hard_cut',
        transition_duration_ms: 0,
      });
      replaceReel(updated);
      const last = updated.segments[updated.segments.length - 1];
      if (last) setEditingSegmentId(last.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir el fragmento');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTitle() {
    if (!activeReel) return;
    setBusy(true);
    try {
      const updated = await updateReel(projectId, activeReel.id, {
        title: titleDraft.trim() || activeReel.title,
        aspect_ratio: aspect,
      });
      replaceReel(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteReel() {
    if (!activeReel) return;
    setBusy(true);
    try {
      await deleteReel(projectId, activeReel.id);
      setConfirmDeleteReel(false);
      setActiveReelId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  }

  async function adjustEdge(segment: ReelSegment, edge: 'start' | 'end', delta: number) {
    if (!activeReel) return;
    const start =
      edge === 'start'
        ? round3(segment.source_start_seconds + delta)
        : segment.source_start_seconds;
    const end =
      edge === 'end' ? round3(segment.source_end_seconds + delta) : segment.source_end_seconds;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateReelSegment(projectId, activeReel.id, segment.id, {
        source_start_seconds: start,
        source_end_seconds: end,
      });
      replaceReel(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ajuste inválido');
    } finally {
      setBusy(false);
    }
  }

  async function handleSegmentField(
    segment: ReelSegment,
    patch: {
      source_start_seconds?: number;
      source_end_seconds?: number;
      transition_type?: TransitionType;
      transition_duration_ms?: number;
      transcript_text?: string;
    },
  ) {
    if (!activeReel) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { ...patch };
      if (patch.transition_type && patch.transition_duration_ms === undefined) {
        payload.transition_duration_ms = defaultTransitionMs(patch.transition_type);
      }
      const updated = await updateReelSegment(projectId, activeReel.id, segment.id, payload);
      replaceReel(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el fragmento');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveSegment(segmentId: string) {
    if (!activeReel) return;
    setBusy(true);
    try {
      const updated = await removeReelSegment(projectId, activeReel.id, segmentId);
      replaceReel(updated);
      if (editingSegmentId === segmentId) setEditingSegmentId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el fragmento');
    } finally {
      setBusy(false);
    }
  }

  async function moveSegment(segmentId: string, direction: -1 | 1) {
    if (!activeReel) return;
    const ordered = [...activeReel.segments].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((s) => s.id === segmentId);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setBusy(true);
    try {
      const updated = await reorderReelSegments(
        projectId,
        activeReel.id,
        next.map((seg, order) => ({ id: seg.id, order })),
      );
      replaceReel(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reordenar');
    } finally {
      setBusy(false);
    }
  }

  function stopPreview() {
    previewingRef.current = false;
    setPreviewing(false);
    const video = videoRef.current;
    if (video) video.pause();
  }

  function startPreview() {
    if (!activeReel || activeReel.segments.length === 0 || !videoRef.current) return;
    previewIndexRef.current = 0;
    setPreviewIndex(0);
    previewingRef.current = true;
    setPreviewing(true);
    const first = [...activeReel.segments].sort((a, b) => a.order - b.order)[0];
    const video = videoRef.current;
    video.currentTime = first.source_start_seconds;
    void video.play();
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeReel) return;

    function onTimeUpdate() {
      if (!video) return;
      setSourceTime(video.currentTime);
      if (!previewingRef.current || !activeReel) return;
      const ordered = [...activeReel.segments].sort((a, b) => a.order - b.order);
      const index = previewIndexRef.current;
      const current = ordered[index];
      if (!current) {
        stopPreview();
        return;
      }
      if (video.currentTime >= current.source_end_seconds - 0.04) {
        const nextIndex = index + 1;
        if (nextIndex >= ordered.length) {
          stopPreview();
          return;
        }
        previewIndexRef.current = nextIndex;
        setPreviewIndex(nextIndex);
        video.currentTime = ordered[nextIndex].source_start_seconds;
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [activeReel]);

  const orderedSegments = useMemo(
    () => (activeReel ? [...activeReel.segments].sort((a, b) => a.order - b.order) : []),
    [activeReel],
  );

  const timedTranscript = transcriptSegments.filter(
    (s) => s.start_seconds != null && s.end_seconds != null,
  );

  return (
    <section className="card reel-editor">
      <div className="transcript-editor__header">
        <h2>Reels (fragmentos no consecutivos)</h2>
        {activeReel && (
          <span className={`badge badge--${activeReel.status}`}>{activeReel.status}</span>
        )}
      </div>

      <p className="muted">
        Un Reel es una secuencia de ventanas del video original. Los fragmentos pueden dejar huecos;
        la línea de tiempo muestra cada salto con claridad.
      </p>

      {loading && <p className="muted">Cargando Reels…</p>}
      {error && <p className="error">{error}</p>}

      <div className="reel-toolbar">
        <label className="field field--inline">
          <span>Título</span>
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field field--inline">
          <span>Formato</span>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as AspectRatio)}
            disabled={busy}
          >
            {ASPECT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="button-stack">
          <button type="button" onClick={() => void handleCreateEmpty()} disabled={busy}>
            Reel vacío
          </button>
          <button
            type="button"
            onClick={() => void handleCreateFromSelection()}
            disabled={busy || selectedTranscriptIds.length === 0}
          >
            Crear Reel desde selección
          </button>
        </div>
      </div>

      {reels.length > 0 && (
        <div className="reel-tabs">
          {reels.map((reel) => (
            <button
              key={reel.id}
              type="button"
              className={`reel-tab${reel.id === activeReelId ? ' reel-tab--active' : ''}`}
              onClick={() => {
                stopPreview();
                setActiveReelId(reel.id);
                setAspect(reel.aspect_ratio);
              }}
            >
              {reel.title}
              <span className="muted"> · {reel.segments.length} frag.</span>
            </button>
          ))}
        </div>
      )}

      <div className="reel-picker">
        <h3>Seleccionar texto de la transcripción</h3>
        {timedTranscript.length === 0 ? (
          <p className="muted">
            Importa o genera una transcripción con tiempos para crear fragmentos desde el texto.
          </p>
        ) : (
          <ul className="segment-list reel-picker__list">
            {timedTranscript.map((segment) => {
              const checked = selectedTranscriptIds.includes(segment.id);
              return (
                <li
                  key={segment.id}
                  className={`segment-item${checked ? ' segment-item--selected' : ''}`}
                >
                  <label className="reel-picker__row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTranscript(segment.id)}
                    />
                    <span className="segment-item__time">
                      {formatTimecode(segment.start_seconds)} –{' '}
                      {formatTimecode(segment.end_seconds)}
                    </span>
                    <span className="segment-item__text">{segment.text}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {activeReel && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void handleAppendFromSelection()}
            disabled={busy || selectedTranscriptIds.length === 0}
          >
            Añadir selección al Reel actual
          </button>
        )}
      </div>

      {activeReel && (
        <>
          <div className="reel-toolbar">
            <button type="button" onClick={() => void handleSaveTitle()} disabled={busy}>
              Guardar metadatos
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void handleAddManualFragment()}
              disabled={busy}
            >
              Añadir otro fragmento
            </button>
            {hasVideo && (
              <button
                type="button"
                onClick={() => (previewing ? stopPreview() : startPreview())}
                disabled={orderedSegments.length === 0}
              >
                {previewing ? 'Detener vista previa' : 'Vista previa lógica'}
              </button>
            )}
            <button
              type="button"
              className="button button--danger"
              onClick={() => setConfirmDeleteReel(true)}
              disabled={busy}
            >
              Eliminar Reel
            </button>
          </div>

          <div className="reel-summary">
            <p>
              Duración de contenido:{' '}
              <strong>{formatDuration(activeReel.content_duration_seconds)}</strong>
              {' · '}
              Con transiciones: <strong>{formatDuration(activeReel.total_duration_seconds)}</strong>
              {' · '}
              Formato {activeReel.aspect_ratio}
            </p>
            <p className="reel-formula" aria-label="Composición del Reel">
              {orderedSegments.length === 0 && (
                <span className="muted">Sin fragmentos todavía.</span>
              )}
              {orderedSegments.map((segment, index) => (
                <span key={segment.id} className="reel-formula__part">
                  {index > 0 && <span className="reel-formula__plus"> + </span>}
                  <span
                    className={`reel-formula__range${
                      previewing && previewIndex === index ? ' reel-formula__range--active' : ''
                    }`}
                  >
                    {formatTimecode(segment.source_start_seconds)}–
                    {formatTimecode(segment.source_end_seconds)}
                  </span>
                </span>
              ))}
            </p>
          </div>

          {hasVideo && (
            <div className="reel-player">
              <video
                ref={videoRef}
                className="transcript-editor__video"
                controls={!previewing}
                preload="metadata"
                src={projectVideoUrl(projectId)}
              >
                Tu navegador no soporta video HTML5.
              </video>
              <div id="reel-subtitle-overlay" className="reel-player__subtitle-slot" />
            </div>
          )}

          <SubtitlePanel
            projectId={projectId}
            reel={activeReel}
            sourceTime={sourceTime}
            previewSegmentIndex={previewing ? previewIndex : null}
            onReelUpdated={replaceReel}
          />

          <FramingPanel
            projectId={projectId}
            reel={activeReel}
            sourceTime={sourceTime}
            onReelChange={replaceReel}
          />

          <CutSuggestionsPanel
            projectId={projectId}
            reelId={activeReel.id}
            segmentIds={orderedSegments.map((segment) => segment.id)}
            onReelChange={replaceReel}
            onReportChange={setCutReport}
          />

          <ol className="reel-timeline">
            {orderedSegments.map((segment, index) => {
              const next = orderedSegments[index + 1];
              const gap = next ? gapSeconds(segment, next) : null;
              const isEditing = editingSegmentId === segment.id;
              return (
                <li key={segment.id} className="reel-timeline__item">
                  <div className="reel-timeline__header">
                    <span className="reel-timeline__index">Fragmento {index + 1}</span>
                    <span className="reel-timeline__range">
                      {formatTimecode(segment.source_start_seconds)} –{' '}
                      {formatTimecode(segment.source_end_seconds)}
                      <span className="muted"> ({formatDuration(segment.duration_seconds)})</span>
                    </span>
                    <div className="button-stack">
                      <button
                        type="button"
                        className="button button--inline"
                        disabled={busy || index === 0}
                        onClick={() => void moveSegment(segment.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="button button--inline"
                        disabled={busy || index === orderedSegments.length - 1}
                        onClick={() => void moveSegment(segment.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="button button--inline"
                        onClick={() => setEditingSegmentId(isEditing ? null : segment.id)}
                      >
                        {isEditing ? 'Cerrar' : 'Ajustar'}
                      </button>
                      <button
                        type="button"
                        className="button button--inline button--danger"
                        onClick={() => void handleRemoveSegment(segment.id)}
                        disabled={busy}
                      >
                        Quitar
                      </button>
                    </div>
                  </div>

                  {segment.transcript_text && (
                    <p className="reel-timeline__text">{segment.transcript_text}</p>
                  )}

                  <CutSuggestionMarkers
                    suggestions={cutReport?.suggestions ?? []}
                    segmentUuid={segment.id}
                    busy={cutBusy || busy}
                    onAccept={(suggestion) => void handleAcceptCut(suggestion)}
                    onReject={(suggestion) => void handleRejectCut(suggestion)}
                  />

                  {isEditing && (
                    <div className="reel-segment-edit">
                      <div className="reel-adjust">
                        <span>Inicio</span>
                        <input
                          type="number"
                          step="0.01"
                          value={segment.source_start_seconds}
                          onChange={(e) =>
                            void handleSegmentField(segment, {
                              source_start_seconds: Number(e.target.value),
                            })
                          }
                        />
                        {ADJUST_STEPS.map((step) => (
                          <button
                            key={`start-${step}`}
                            type="button"
                            className="button button--inline"
                            disabled={busy}
                            onClick={() => void adjustEdge(segment, 'start', step)}
                          >
                            {step > 0 ? `+${step}` : step} s
                          </button>
                        ))}
                      </div>
                      <div className="reel-adjust">
                        <span>Fin</span>
                        <input
                          type="number"
                          step="0.01"
                          value={segment.source_end_seconds}
                          onChange={(e) =>
                            void handleSegmentField(segment, {
                              source_end_seconds: Number(e.target.value),
                            })
                          }
                        />
                        {ADJUST_STEPS.map((step) => (
                          <button
                            key={`end-${step}`}
                            type="button"
                            className="button button--inline"
                            disabled={busy}
                            onClick={() => void adjustEdge(segment, 'end', step)}
                          >
                            {step > 0 ? `+${step}` : step} s
                          </button>
                        ))}
                      </div>
                      <label className="field field--inline">
                        <span>Transición → siguiente</span>
                        <select
                          value={segment.transition_type}
                          disabled={busy || !next}
                          onChange={(e) =>
                            void handleSegmentField(segment, {
                              transition_type: e.target.value as TransitionType,
                            })
                          }
                        >
                          {TRANSITION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {segment.transition_type !== 'hard_cut' && (
                        <label className="field field--inline">
                          <span>Duración transición (ms)</span>
                          <input
                            type="number"
                            min={1}
                            max={5000}
                            value={segment.transition_duration_ms}
                            disabled={busy || !next}
                            onChange={(e) =>
                              void handleSegmentField(segment, {
                                transition_duration_ms: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                  )}

                  {next && (
                    <div
                      className={`reel-jump${gap != null && gap > 0.05 ? ' reel-jump--gap' : ''}`}
                    >
                      <span className="reel-jump__mark">⤵ salto</span>
                      {gap != null && gap > 0.05 ? (
                        <span>
                          Omite {formatTimecode(segment.source_end_seconds)} →{' '}
                          {formatTimecode(next.source_start_seconds)} ({formatDuration(gap)} del
                          original)
                        </span>
                      ) : gap != null && gap < -0.05 ? (
                        <span>Solapa {formatDuration(Math.abs(gap))} con el siguiente</span>
                      ) : (
                        <span>Continúa casi sin hueco</span>
                      )}
                      {segment.transition_type !== 'hard_cut' && (
                        <span className="muted">
                          {' '}
                          · {segment.transition_type} {segment.transition_duration_ms} ms
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <EndCardPanel
            projectId={projectId}
            aspectRatio={activeReel.aspect_ratio}
            hasCover={hasCover}
          />

          <BackgroundMusicPanel projectId={projectId} />

          <RenderPanel
            projectId={projectId}
            reelId={activeReel.id}
            reelAspectRatio={activeReel.aspect_ratio}
            segments={activeReel.segments}
            onReelChange={replaceReel}
          />
        </>
      )}

      {confirmDeleteReel && activeReel && (
        <ConfirmDialog
          title="Eliminar Reel"
          message={`¿Eliminar «${activeReel.title}» y todos sus fragmentos?`}
          busy={busy}
          onConfirm={() => void handleDeleteReel()}
          onCancel={() => !busy && setConfirmDeleteReel(false)}
        />
      )}
    </section>
  );
}
