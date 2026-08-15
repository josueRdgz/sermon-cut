import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, API_BASE_URL } from '../api/client';
import { listAssets } from '../api/assets';
import {
  createOverlay,
  deleteOverlay,
  listOverlays,
  updateOverlay,
} from '../api/overlays';
import {
  addReelSegment,
  assembledPreviewUrl,
  createReel,
  createReelFromTranscript,
  deleteReel,
  listReels,
  prepareAssembledPreview,
  removeReelSegment,
  reorderReelSegments,
  updateReel,
  updateReelSegment,
} from '../api/reels';
import { getTranscript } from '../api/transcripts';
import { projectVideoUrl } from '../api/projects';
import type { ProjectAsset } from '../types/asset';
import type { ReelOverlay } from '../types/overlay';
import type { Project } from '../types/project';
import type { AspectRatio, Reel, ReelSegment, TransitionType } from '../types/reel';
import type { TranscriptSegment } from '../types/transcript';
import { formatDuration, formatTimecode } from '../utils/format';
import { buildOutputClock } from '../utils/reelOutputClock';
import { pinWorkspaceNav } from '../utils/workspaceScroll';
import { ConfirmDialog } from './ConfirmDialog';
import { CutSuggestionMarkers, CutSuggestionsPanel } from './CutSuggestionsPanel';
import { BackgroundMusicPanel } from './BackgroundMusicPanel';
import { EndCardPanel } from './EndCardPanel';
import { FramingPanel } from './FramingPanel';
import { MediaBinPanel } from './MediaBinPanel';
import { OverlayPreviewLayer } from './OverlayPreviewLayer';
import { RenderPanel } from './RenderPanel';
import { ReelTimelineStrip, type TimelineTrackKind } from './ReelTimelineStrip';
import { SubtitlePanel } from './SubtitlePanel';
import type { CutSuggestion, CutSuggestionsReport } from '../types/cutSuggestions';
import { acceptCutSuggestion, rejectCutSuggestion } from '../api/cutSuggestions';
import {
  backgroundMusicAudioUrl,
  getBackgroundMusic,
  saveBackgroundMusic,
} from '../api/backgroundMusic';
import type { BackgroundMusicSettings } from '../types/backgroundMusic';
import {
  previewTimelineIdentity,
  resolvePreviewSeek,
  type PreviewSeekTarget,
} from '../utils/reelPreview';

function overlappingTranscriptSegments(
  segments: TranscriptSegment[],
  start: number,
  end: number,
): TranscriptSegment[] {
  return segments
    .filter(
      (item) =>
        item.start_seconds != null &&
        item.end_seconds != null &&
        item.start_seconds < end &&
        item.end_seconds > start,
    )
    .sort((a, b) => (a.start_seconds ?? 0) - (b.start_seconds ?? 0));
}

/** Caption text that actually falls inside a reel cut (not the whole Whisper span). */
function transcriptTextInWindow(
  segment: TranscriptSegment,
  start: number,
  end: number,
): string {
  const words = [...segment.words]
    .filter(
      (word) =>
        word.start_seconds != null &&
        word.end_seconds != null &&
        word.start_seconds < end &&
        word.end_seconds > start,
    )
    .sort((a, b) => (a.start_seconds ?? 0) - (b.start_seconds ?? 0));
  if (words.length > 0) {
    return words
      .map((word) => word.text.trim())
      .filter(Boolean)
      .join(' ');
  }
  // Only fall back to the full span when it itself sits mostly inside the cut.
  if (
    segment.start_seconds != null &&
    segment.end_seconds != null &&
    segment.start_seconds >= start - 0.05 &&
    segment.end_seconds <= end + 0.05
  ) {
    return segment.text.trim();
  }
  return '';
}

/** Joined caption preview for one reel cut from all overlapping Whisper spans. */
function captionPreviewForCut(
  segments: TranscriptSegment[],
  start: number,
  end: number,
): string {
  return overlappingTranscriptSegments(segments, start, end)
    .map((item) => transcriptTextInWindow(item, start, end))
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Saved per-cut caption always wins. Otherwise show Whisper words in the cut.
 */
function fragmentCaptionBaseline(
  segment: ReelSegment,
  transcriptSegments: TranscriptSegment[],
): string {
  const saved = segment.transcript_text?.trim() ?? '';
  if (saved) return saved;
  return captionPreviewForCut(
    transcriptSegments,
    segment.source_start_seconds,
    segment.source_end_seconds,
  );
}

interface ReelEditorProps {
  projectId: string;
  hasVideo: boolean;
  hasCover: boolean;
  videoDuration: number | null;
  mediaRevision?: string | number | null;
  refreshToken?: number;
  focusReelId?: string | null;
  onCoverUpdated?: (project: Project) => void;
}

const ASPECT_OPTIONS: AspectRatio[] = ['9:16', '1:1', '16:9'];
const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'hard_cut', label: 'Corte duro' },
  { value: 'short_crossfade', label: 'Fundido cruzado' },
  { value: 'dip_to_black', label: 'Fundido a negro' },
  { value: 'fade', label: 'Difuminar' },
  { value: 'flash', label: 'Destello' },
];

const ADJUST_STEPS = [-1, -0.1, 0.1, 1] as const;
const REEL_TOOLS = [
  { id: 'cuts', label: 'Cortes', description: 'Fragmentos y transiciones' },
  { id: 'framing', label: 'Encuadre', description: 'Formato vertical' },
  { id: 'subtitles', label: 'Subtítulos', description: 'Texto sobre imagen' },
  { id: 'audio', label: 'Audio', description: 'Sincronía y música' },
  { id: 'end-card', label: 'Pantalla final', description: 'Imagen y llamado' },
  { id: 'export', label: 'Exportar', description: 'Validar y generar MP4' },
] as const;

type ReelTool = (typeof REEL_TOOLS)[number]['id'];

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function gapSeconds(prev: ReelSegment, next: ReelSegment): number {
  return next.source_start_seconds - prev.source_end_seconds;
}

function audioTimeForVideo(videoTime: number, offsetMs: number): number {
  return Math.max(0, videoTime - offsetMs / 1000);
}

function clampMediaTime(media: HTMLMediaElement, seconds: number): number {
  const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
  return Math.max(0, duration == null ? seconds : Math.min(seconds, duration));
}

function setMediaTime(media: HTMLMediaElement, seconds: number, approximate = false): boolean {
  if (media.readyState < HTMLMediaElement.HAVE_METADATA) return false;
  const target = clampMediaTime(media, seconds);
  try {
    const seekableMedia = media as HTMLMediaElement & { fastSeek?: (time: number) => void };
    if (approximate && typeof seekableMedia.fastSeek === 'function') {
      seekableMedia.fastSeek(target);
    } else {
      media.currentTime = target;
    }
    return true;
  } catch {
    // WebKit can reject a seek while metadata/ranges are being refreshed.
    // Keeping the pending target allows loadedmetadata or the final commit to retry.
    return false;
  }
}

function waitForSeek(media: HTMLMediaElement, seconds: number): Promise<void> {
  if (media.readyState < HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  const target = clampMediaTime(media, seconds);
  if (!media.seeking && Math.abs(media.currentTime - target) < 0.04) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      media.removeEventListener('seeked', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 900);
    media.addEventListener('seeked', finish, { once: true });
    if (!setMediaTime(media, target)) finish();
  });
}

export function ReelEditor({
  projectId,
  hasVideo,
  hasCover,
  videoDuration,
  mediaRevision = null,
  refreshToken = 0,
  focusReelId = null,
  onCoverUpdated,
}: ReelEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
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
  const [previewOutputTime, setPreviewOutputTime] = useState(0);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [previewVolume, setPreviewVolume] = useState(1);
  const [activeTool, setActiveTool] = useState<ReelTool>('cuts');
  const [audioOffsetMs, setAudioOffsetMs] = useState(0);
  const [audioOffsetSaving, setAudioOffsetSaving] = useState(false);
  const [sourceTime, setSourceTime] = useState<number | null>(null);
  const [cutReport, setCutReport] = useState<CutSuggestionsReport | null>(null);
  const [cutBusy, setCutBusy] = useState(false);
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({});
  const [transcriptSavingId, setTranscriptSavingId] = useState<string | null>(null);
  const [showAddFragment, setShowAddFragment] = useState(false);
  const [addFragmentStart, setAddFragmentStart] = useState(0);
  const [addFragmentEnd, setAddFragmentEnd] = useState(5);
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundMusicSettings | null>(null);
  const [musicVolumeSaving, setMusicVolumeSaving] = useState(false);
  const [musicVolumeDraft, setMusicVolumeDraft] = useState<number | null>(null);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [overlays, setOverlays] = useState<ReelOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(80);
  const [assembledPreviewSrc, setAssembledPreviewSrc] = useState<string | null>(null);
  const [assembledBusy, setAssembledBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState<'logical' | 'assembled'>('logical');
  const musicVolumeSaveTimerRef = useRef<number | null>(null);
  const segmentPersistTimerRef = useRef<number | null>(null);
  const overlayPersistTimerRef = useRef<number | null>(null);
  const assembledVideoRef = useRef<HTMLVideoElement>(null);
  const reloadEpochRef = useRef(0);
  const previewIndexRef = useRef(0);
  const previewingRef = useRef(false);
  const focusedReelRef = useRef<string | null>(null);
  const audioOffsetRef = useRef(0);
  const pendingAudioTimeRef = useRef<number | null>(null);
  const pendingVideoTimeRef = useRef<number | null>(null);
  const pendingPreviewSeekRef = useRef<PreviewSeekTarget | null>(null);
  const seekAnimationFrameRef = useRef<number | null>(null);
  const audioOffsetSeekTimerRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const resumeAfterScrubRef = useRef(false);
  const jumpingRef = useRef(false);
  const jumpTokenRef = useRef(0);
  const previewMutedRef = useRef(false);
  const previewVolumeRef = useRef(1);

  const activeReel = useMemo(
    () => reels.find((reel) => reel.id === activeReelId) ?? null,
    [reels, activeReelId],
  );

  const reload = useCallback(async () => {
    const epoch = ++reloadEpochRef.current;
    setLoading(true);
    try {
      const [reelList, transcript] = await Promise.all([
        listReels(projectId),
        getTranscript(projectId).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
      ]);
      // Ignore stale reloads that finished after a newer local replaceReel/save.
      if (epoch !== reloadEpochRef.current) return;
      setReels(reelList.items);
      setTranscriptSegments(transcript?.segments ?? []);
      setError(null);
      setActiveReelId((current) => {
        if (current && reelList.items.some((r) => r.id === current)) return current;
        return reelList.items[0]?.id ?? null;
      });
    } catch (err) {
      if (epoch !== reloadEpochRef.current) return;
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los Reels');
    } finally {
      if (epoch === reloadEpochRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // A newly accepted AI candidate increments this token so the list refreshes.
    void refreshToken;
    void reload();
  }, [reload, refreshToken]);

  useEffect(() => {
    if (
      !focusReelId ||
      focusedReelRef.current === focusReelId ||
      !reels.some((reel) => reel.id === focusReelId)
    ) {
      return;
    }
    const reel = reels.find((item) => item.id === focusReelId);
    focusedReelRef.current = focusReelId;
    stopPreview();
    setActiveReelId(focusReelId);
    if (reel) setAspect(reel.aspect_ratio);
  }, [focusReelId, reels]);

  useEffect(() => {
    if (activeReel) setTitleDraft(activeReel.title);
  }, [activeReel?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only sync on reel switch

  useEffect(() => {
    const savedOffset = activeReel?.audio_offset_ms ?? 0;
    audioOffsetRef.current = savedOffset;
    setAudioOffsetMs(savedOffset);
  }, [activeReel?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- initialize on switch

  useEffect(() => {
    if (!activeReel || audioOffsetMs === (activeReel.audio_offset_ms ?? 0)) return;
    const reelId = activeReel.id;
    const offset = audioOffsetMs;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAudioOffsetSaving(true);
      updateReel(projectId, reelId, { audio_offset_ms: offset })
        .then((updated) => {
          if (cancelled) return;
          setReels((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(
              err instanceof Error ? err.message : 'No se pudo guardar la sincronía de audio',
            );
          }
        })
        .finally(() => {
          if (!cancelled) setAudioOffsetSaving(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeReel, audioOffsetMs, projectId]);

  function replaceReel(updated: Reel) {
    reloadEpochRef.current += 1;
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
    const start = round3(addFragmentStart);
    const end = round3(addFragmentEnd);
    if (!(end > start + 0.05)) {
      setError('El fin debe ser mayor que el inicio (mínimo ~0.1 s).');
      return;
    }
    if (videoDuration != null && end > videoDuration + 0.05) {
      setError('El fin supera la duración del video.');
      return;
    }
    if (start < 0) {
      setError('El inicio no puede ser negativo.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await addReelSegment(projectId, activeReel.id, {
        source_start_seconds: start,
        source_end_seconds: end,
        transition_type: 'hard_cut',
        transition_duration_ms: 0,
      });
      replaceReel(updated);
      const last = updated.segments[updated.segments.length - 1];
      if (last) setEditingSegmentId(last.id);
      setShowAddFragment(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir el fragmento');
    } finally {
      setBusy(false);
    }
  }

  function openAddFragmentForm() {
    const lastSeg = activeReel?.segments[activeReel.segments.length - 1];
    const hint = sourceTime ?? lastSeg?.source_end_seconds ?? 0;
    const start = round3(Math.max(0, hint));
    const rawEnd = Math.min(videoDuration ?? start + 5, start + 5);
    setAddFragmentStart(start);
    setAddFragmentEnd(round3(rawEnd > start ? rawEnd : start + 5));
    setShowAddFragment(true);
    setError(null);
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
      if (patch.transition_type && patch.transition_type !== 'hard_cut') {
        const currentMs =
          patch.transition_duration_ms ?? segment.transition_duration_ms ?? 0;
        if (patch.transition_duration_ms === undefined && currentMs <= 0) {
          payload.transition_duration_ms = 350;
        }
      } else if (patch.transition_type === 'hard_cut') {
        payload.transition_duration_ms = 0;
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

  async function saveFragmentCaption(segment: ReelSegment, draftOverride?: string) {
    if (!activeReel) return;
    const baseline = fragmentCaptionBaseline(segment, timedTranscript);
    const draft = (draftOverride ?? transcriptDrafts[segment.id] ?? baseline).trim();
    if (!draft) {
      setError(
        'El subtítulo del fragmento no puede quedar vacío. Usa “Texto del video” para restablecer.',
      );
      return;
    }
    // Already persisted exactly as drafted.
    if (draft === (segment.transcript_text ?? '').trim() && segment.transcript_text != null) {
      setTranscriptDrafts((current) => {
        const next = { ...current };
        delete next[segment.id];
        return next;
      });
      return;
    }
    setTranscriptSavingId(segment.id);
    setError(null);
    try {
      const updated = await updateReelSegment(projectId, activeReel.id, segment.id, {
        transcript_text: draft,
      });
      const saved = updated.segments.find((item) => item.id === segment.id);
      if (!saved || (saved.transcript_text ?? '').trim() !== draft) {
        throw new Error('El servidor no persistió el subtítulo del fragmento.');
      }
      replaceReel(updated);
      setTranscriptDrafts((current) => {
        const next = { ...current };
        delete next[segment.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el texto del fragmento');
      throw err;
    } finally {
      setTranscriptSavingId(null);
    }
  }

  /** Persist any unsaved fragment captions before export so burn-in matches the editor. */
  async function flushCaptionDraftsForExport(): Promise<void> {
    if (!activeReel) return;
    const ordered = [...activeReel.segments].sort((a, b) => a.order - b.order);
    for (const segment of ordered) {
      const baseline = fragmentCaptionBaseline(segment, timedTranscript);
      const draft = (transcriptDrafts[segment.id] ?? baseline).trim();
      if (!draft) continue;
      if (draft === (segment.transcript_text ?? '').trim() && segment.transcript_text != null) {
        continue;
      }
      await saveFragmentCaption(segment, draft);
    }
  }

  async function clearFragmentCaption(segment: ReelSegment) {
    if (!activeReel) return;
    setTranscriptSavingId(segment.id);
    setError(null);
    try {
      const updated = await updateReelSegment(projectId, activeReel.id, segment.id, {
        transcript_text: null,
      });
      replaceReel(updated);
      setTranscriptDrafts((current) => {
        const next = { ...current };
        delete next[segment.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restablecer el texto');
    } finally {
      setTranscriptSavingId(null);
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

  function debounceSegmentPersist(run: () => void) {
    if (segmentPersistTimerRef.current != null) {
      window.clearTimeout(segmentPersistTimerRef.current);
    }
    segmentPersistTimerRef.current = window.setTimeout(() => {
      segmentPersistTimerRef.current = null;
      run();
    }, 300);
  }

  function debounceOverlayPersist(run: () => void) {
    if (overlayPersistTimerRef.current != null) {
      window.clearTimeout(overlayPersistTimerRef.current);
    }
    overlayPersistTimerRef.current = window.setTimeout(() => {
      overlayPersistTimerRef.current = null;
      run();
    }, 300);
  }

  async function reloadOverlays(reelId: string) {
    try {
      const response = await listOverlays(projectId, reelId);
      setOverlays(response.items);
      setSelectedOverlayId((current) =>
        current && response.items.some((item) => item.id === current) ? current : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los overlays');
    }
  }

  function handleReorderSegments(orderedIds: string[]) {
    if (!activeReel) return;
    debounceSegmentPersist(() => {
      void (async () => {
        try {
          const updated = await reorderReelSegments(
            projectId,
            activeReel.id,
            orderedIds.map((id, order) => ({ id, order })),
          );
          replaceReel(updated);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'No se pudo reordenar');
        }
      })();
    });
  }

  function handleTrimSegment(
    id: string,
    patch: { source_start_seconds?: number; source_end_seconds?: number },
  ) {
    if (!activeReel) return;
    // Optimistic local update for snappy trim handles.
    setReels((prev) =>
      prev.map((reel) => {
        if (reel.id !== activeReel.id) return reel;
        return {
          ...reel,
          segments: reel.segments.map((segment) =>
            segment.id === id
              ? {
                  ...segment,
                  ...patch,
                  duration_seconds: Math.max(
                    0,
                    (patch.source_end_seconds ?? segment.source_end_seconds) -
                      (patch.source_start_seconds ?? segment.source_start_seconds),
                  ),
                }
              : segment,
          ),
        };
      }),
    );
    debounceSegmentPersist(() => {
      void (async () => {
        try {
          const updated = await updateReelSegment(projectId, activeReel.id, id, patch);
          replaceReel(updated);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Ajuste inválido');
          void reload();
        }
      })();
    });
  }

  function handleMoveOverlay(id: string, startMs: number) {
    if (!activeReel) return;
    setOverlays((prev) =>
      prev.map((overlay) => (overlay.id === id ? { ...overlay, start_ms: startMs } : overlay)),
    );
    debounceOverlayPersist(() => {
      void (async () => {
        try {
          const updated = await updateOverlay(projectId, activeReel.id, id, {
            start_ms: startMs,
          });
          setOverlays((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'No se pudo mover el overlay');
          void reloadOverlays(activeReel.id);
        }
      })();
    });
  }

  async function handleDropAsset(assetId: string, outputSeconds: number) {
    if (!activeReel) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createOverlay(projectId, activeReel.id, {
        kind: 'image',
        asset_id: assetId,
        start_ms: Math.max(0, Math.round(outputSeconds * 1000)),
        duration_ms: 3000,
      });
      setOverlays((prev) => [...prev, created].sort((a, b) => a.start_ms - b.start_ms));
      setSelectedOverlayId(created.id);
      setActiveTool('cuts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el overlay');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddTextOverlay(outputSeconds: number) {
    if (!activeReel) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createOverlay(projectId, activeReel.id, {
        kind: 'text',
        text: 'Texto',
        start_ms: Math.max(0, Math.round(outputSeconds * 1000)),
        duration_ms: 3000,
      });
      setOverlays((prev) => [...prev, created].sort((a, b) => a.start_ms - b.start_ms));
      setSelectedOverlayId(created.id);
      setActiveTool('cuts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el texto');
    } finally {
      setBusy(false);
    }
  }

  async function handleOverlayField(
    overlay: ReelOverlay,
    patch: {
      text?: string | null;
      start_ms?: number;
      duration_ms?: number;
      scale?: number;
      opacity?: number;
      x?: number;
      y?: number;
    },
  ) {
    if (!activeReel) return;
    setOverlays((prev) =>
      prev.map((item) => (item.id === overlay.id ? { ...item, ...patch } : item)),
    );
    debounceOverlayPersist(() => {
      void (async () => {
        try {
          const updated = await updateOverlay(projectId, activeReel.id, overlay.id, patch);
          setOverlays((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        } catch (err) {
          setError(err instanceof Error ? err.message : 'No se pudo actualizar el overlay');
          void reloadOverlays(activeReel.id);
        }
      })();
    });
  }

  async function handleDeleteOverlay(overlayId: string) {
    if (!activeReel) return;
    setBusy(true);
    try {
      await deleteOverlay(projectId, activeReel.id, overlayId);
      setOverlays((prev) => prev.filter((item) => item.id !== overlayId));
      if (selectedOverlayId === overlayId) setSelectedOverlayId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el overlay');
    } finally {
      setBusy(false);
    }
  }

  async function switchPreviewMode(mode: 'logical' | 'assembled') {
    if (!activeReel) return;
    if (mode === 'logical') {
      stopPreview();
      setPreviewMode('logical');
      return;
    }
    setAssembledBusy(true);
    setError(null);
    stopPreview();
    try {
      await prepareAssembledPreview(projectId, activeReel.id);
      setAssembledPreviewSrc(
        `${API_BASE_URL}${assembledPreviewUrl(projectId, activeReel.id)}?t=${Date.now()}`,
      );
      setPreviewMode('assembled');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar el preview ensamblado');
      setPreviewMode('logical');
    } finally {
      setAssembledBusy(false);
    }
  }

  function usesSeparateAudio(): boolean {
    // Offset needs a second clock. Otherwise keep A/V locked in one element so
    // hard cuts do not desync or leave silence while the second element seeks.
    return Math.abs(audioOffsetRef.current) >= 1;
  }

  function musicPreviewActive(settings: BackgroundMusicSettings | null = backgroundMusic): boolean {
    return Boolean(
      settings?.enabled &&
        settings.music_filename &&
        settings.scope === 'full_reel' &&
        settings.preset !== 'none',
    );
  }

  function applyMusicGain(settings: BackgroundMusicSettings | null = backgroundMusic) {
    const music = musicRef.current;
    if (!music) return;
    const muted = previewMutedRef.current;
    const bed = musicPreviewActive(settings) ? Math.max(0, Math.min(1, settings?.volume ?? 0)) : 0;
    music.muted = muted || bed <= 0;
    music.volume = muted ? 0 : bed;
  }

  /** Bed track follows the continuous reel timeline, not each source cut. */
  async function ensureMusicAtOutput(
    outputSeconds: number,
    options: { force?: boolean; play?: boolean } = {},
  ) {
    const music = musicRef.current;
    const settings = backgroundMusic;
    if (!music || !musicPreviewActive(settings) || !settings) return;
    applyMusicGain(settings);
    const start = settings.start_seconds ?? 0;
    const end = settings.end_seconds;
    const target = start + Math.max(0, outputSeconds);
    if (end != null && target >= end) {
      music.pause();
      return;
    }
    if (music.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const drift = target - music.currentTime;
    if (options.force || Math.abs(drift) >= 0.2) {
      await waitForSeek(music, target);
    }
    const wantPlay = options.play ?? previewingRef.current;
    const shouldPlay = Boolean(
      wantPlay && !scrubbingRef.current && !previewMutedRef.current,
    );
    if (!shouldPlay) return;
    try {
      if (music.paused) await music.play();
    } catch {
      // Autoplay / seek races can fail briefly; the next tick may recover.
    }
  }

  function syncMusicToOutput(outputSeconds: number, force = false) {
    void ensureMusicAtOutput(outputSeconds, {
      force,
      play: previewingRef.current && !scrubbingRef.current,
    });
  }

  async function playMusicForOutput(outputSeconds: number) {
    await ensureMusicAtOutput(outputSeconds, { force: true, play: true });
  }

  function applyPreviewGain() {
    const video = videoRef.current;
    const audio = audioRef.current;
    const separate = usesSeparateAudio();
    const muted = previewMutedRef.current;
    const volume = previewVolumeRef.current;
    if (video) {
      video.muted = separate ? true : muted;
      video.volume = separate ? 1 : muted ? 0 : volume;
    }
    if (audio) {
      audio.muted = separate ? muted : true;
      audio.volume = separate ? (muted ? 0 : volume) : 0;
      if (!separate) {
        audio.pause();
        audio.playbackRate = 1;
      }
    }
    applyMusicGain();
  }

  function stopPreview() {
    previewingRef.current = false;
    scrubbingRef.current = false;
    resumeAfterScrubRef.current = false;
    jumpingRef.current = false;
    pendingPreviewSeekRef.current = null;
    if (seekAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(seekAnimationFrameRef.current);
      seekAnimationFrameRef.current = null;
    }
    if (audioOffsetSeekTimerRef.current != null) {
      window.clearTimeout(audioOffsetSeekTimerRef.current);
      audioOffsetSeekTimerRef.current = null;
    }
    setPreviewing(false);
    const video = videoRef.current;
    if (video) video.pause();
    assembledVideoRef.current?.pause();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.playbackRate = 1;
    }
    musicRef.current?.pause();
  }

  function syncAudioToVideo(videoTime: number, force = false) {
    if (!usesSeparateAudio()) return;
    const audio = audioRef.current;
    if (!audio) return;
    const target = audioTimeForVideo(videoTime, audioOffsetRef.current);
    pendingAudioTimeRef.current = target;
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
    audio.playbackRate = 1;
    const drift = target - audio.currentTime;
    if (force || Math.abs(drift) >= 0.08) {
      if (!setMediaTime(audio, target)) return;
    }
    pendingAudioTimeRef.current = null;
  }

  async function jumpPreviewToSource(sourceTimeSeconds: number, resume: boolean) {
    const video = videoRef.current;
    if (!video) return;
    const token = ++jumpTokenRef.current;
    jumpingRef.current = true;
    video.pause();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.playbackRate = 1;
    }
    // Keep bed music running across hard cuts — it follows the output clock,
    // not the source seek. Pausing here made the bed die between fragments.
    const seeks = [waitForSeek(video, sourceTimeSeconds)];
    if (usesSeparateAudio() && audio) {
      seeks.push(
        waitForSeek(audio, audioTimeForVideo(sourceTimeSeconds, audioOffsetRef.current)),
      );
    }
    await Promise.all(seeks);
    if (token !== jumpTokenRef.current) return;
    pendingVideoTimeRef.current = null;
    pendingAudioTimeRef.current = null;
    jumpingRef.current = false;
    setSourceTime(sourceTimeSeconds);
    if (!resume || !previewingRef.current || scrubbingRef.current) return;
    applyPreviewGain();
    try {
      if (usesSeparateAudio() && audio) {
        await Promise.all([video.play(), audio.play()]);
      } else {
        await video.play();
      }
      if (token !== jumpTokenRef.current) return;
      const ordered = activeReel
        ? [...activeReel.segments].sort((a, b) => a.order - b.order)
        : [];
      const index = previewIndexRef.current;
      const current = ordered[index];
      if (current) {
        const elapsedBefore = ordered
          .slice(0, index)
          .reduce((sum, segment) => sum + Math.max(0, segment.duration_seconds), 0);
        const local = Math.max(
          0,
          Math.min(sourceTimeSeconds - current.source_start_seconds, current.duration_seconds),
        );
        await playMusicForOutput(elapsedBefore + local);
      }
    } catch (err: unknown) {
      if (token !== jumpTokenRef.current) return;
      stopPreview();
      setError(err instanceof Error ? err.message : 'No se pudo reanudar la reproducción');
    }
  }

  function applyAudioOffset(offsetMs: number) {
    audioOffsetRef.current = offsetMs;
    setAudioOffsetMs(offsetMs);
    applyPreviewGain();
    if (audioOffsetSeekTimerRef.current != null) return;
    audioOffsetSeekTimerRef.current = window.setTimeout(() => {
      audioOffsetSeekTimerRef.current = null;
      const video = videoRef.current;
      if (!video) return;
      if (usesSeparateAudio()) {
        syncAudioToVideo(video.currentTime, true);
      } else if (previewingRef.current) {
        void jumpPreviewToSource(video.currentTime, true);
      }
    }, 80);
  }

  function commitAudioOffsetPreview() {
    if (audioOffsetSeekTimerRef.current != null) {
      window.clearTimeout(audioOffsetSeekTimerRef.current);
      audioOffsetSeekTimerRef.current = null;
    }
    const video = videoRef.current;
    if (!video) return;
    applyPreviewGain();
    if (usesSeparateAudio()) {
      syncAudioToVideo(video.currentTime, true);
    }
  }

  async function saveAudioOffset(offsetMs = audioOffsetMs) {
    if (!activeReel) return;
    setAudioOffsetSaving(true);
    setError(null);
    try {
      const updated = await updateReel(projectId, activeReel.id, {
        audio_offset_ms: offsetMs,
      });
      setReels((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la sincronía de audio');
    } finally {
      setAudioOffsetSaving(false);
    }
  }

  function applyPreviewSeek(target: PreviewSeekTarget, approximate: boolean) {
    const video = videoRef.current;
    if (!video) return;
    pendingVideoTimeRef.current = target.sourceTime;
    if (approximate) {
      if (setMediaTime(video, target.sourceTime, true)) {
        pendingVideoTimeRef.current = null;
      }
      return;
    }
    void jumpPreviewToSource(target.sourceTime, previewingRef.current);
  }

  function schedulePreviewSeek(target: PreviewSeekTarget) {
    pendingPreviewSeekRef.current = target;
    if (seekAnimationFrameRef.current != null) return;
    seekAnimationFrameRef.current = window.requestAnimationFrame(() => {
      seekAnimationFrameRef.current = null;
      const pending = pendingPreviewSeekRef.current;
      if (pending) applyPreviewSeek(pending, true);
    });
  }

  function seekPreview(outputSeconds: number) {
    if (previewMode === 'assembled') {
      const total = buildOutputClock(orderedSegments).totalDuration;
      const clamped = Math.max(0, Math.min(total, outputSeconds));
      setPreviewOutputTime(clamped);
      const assembled = assembledVideoRef.current;
      if (assembled && assembled.readyState >= HTMLMediaElement.HAVE_METADATA) {
        try {
          assembled.currentTime = clamped;
        } catch {
          // ignore seek race while loading
        }
      }
      return;
    }
    const target = resolvePreviewSeek(orderedSegments, outputSeconds);
    if (!target || !videoRef.current) return;
    previewIndexRef.current = target.segmentIndex;
    setPreviewIndex(target.segmentIndex);
    setPreviewOutputTime(target.outputTime);
    setSourceTime(target.sourceTime);
    pendingPreviewSeekRef.current = target;
    if (scrubbingRef.current) {
      // Keep the picture responsive while dragging, but do not make the second
      // media element seek on every pointer event.
      schedulePreviewSeek(target);
    } else {
      applyPreviewSeek(target, false);
    }
  }

  function beginPreviewScrub() {
    if (scrubbingRef.current) return;
    scrubbingRef.current = true;
    resumeAfterScrubRef.current = previewingRef.current;
    if (previewMode === 'assembled') {
      assembledVideoRef.current?.pause();
      return;
    }
    videoRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.playbackRate = 1;
    }
    musicRef.current?.pause();
  }

  function endPreviewScrub() {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    if (seekAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(seekAnimationFrameRef.current);
      seekAnimationFrameRef.current = null;
    }
    if (previewMode === 'assembled') {
      const shouldResume = resumeAfterScrubRef.current && previewingRef.current;
      resumeAfterScrubRef.current = false;
      if (shouldResume) {
        void assembledVideoRef.current?.play().catch(() => undefined);
      }
      return;
    }
    const target = pendingPreviewSeekRef.current;
    const shouldResume = resumeAfterScrubRef.current && previewingRef.current;
    resumeAfterScrubRef.current = false;
    if (target) {
      void jumpPreviewToSource(target.sourceTime, shouldResume);
    }
    pendingPreviewSeekRef.current = null;
  }

  function startPreview() {
    if (!activeReel || activeReel.segments.length === 0 || !videoRef.current) {
      return;
    }
    const video = videoRef.current;
    const audio = audioRef.current;
    const total = orderedSegments.reduce(
      (sum, segment) => sum + Math.max(0, segment.duration_seconds),
      0,
    );
    const target =
      previewOutputTime >= total - 0.05
        ? resolvePreviewSeek(orderedSegments, 0)
        : resolvePreviewSeek(orderedSegments, previewOutputTime);
    if (!target) return;
    previewIndexRef.current = target.segmentIndex;
    setPreviewIndex(target.segmentIndex);
    setPreviewOutputTime(target.outputTime);
    setSourceTime(target.sourceTime);
    pendingPreviewSeekRef.current = target;
    previewMutedRef.current = previewMuted;
    previewVolumeRef.current = previewVolume;
    // Prefer a single element (locked A/V). Separate audio only when the user
    // requested an explicit offset — dual seekers break hard cuts in WKWebView.
    applyPreviewGain();
    previewingRef.current = true;
    setPreviewing(true);
    const waitForMetadata = (media: HTMLMediaElement) =>
      media.readyState >= HTMLMediaElement.HAVE_METADATA
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const onReady = () => {
              media.removeEventListener('error', onError);
              resolve();
            };
            const onError = () => {
              media.removeEventListener('loadedmetadata', onReady);
              reject(new Error('No se pudo cargar el medio para el preview'));
            };
            media.addEventListener('loadedmetadata', onReady, { once: true });
            media.addEventListener('error', onError, { once: true });
          });
    const mediaReady =
      usesSeparateAudio() && audio
        ? Promise.all([waitForMetadata(video), waitForMetadata(audio)])
        : waitForMetadata(video);
    void mediaReady
      .then(async () => {
        if (!previewingRef.current || scrubbingRef.current) return;
        await jumpPreviewToSource(target.sourceTime, true);
      })
      .catch((err: unknown) => {
        previewingRef.current = false;
        setPreviewing(false);
        video.pause();
        audio?.pause();
        setError(err instanceof Error ? err.message : 'El navegador bloqueó la reproducción');
      });
  }

  function togglePreviewAudio() {
    const nextMuted = !previewMuted;
    const nextVolume = !nextMuted && previewVolume === 0 ? 0.8 : previewVolume;
    if (nextVolume !== previewVolume) setPreviewVolume(nextVolume);
    setPreviewMuted(nextMuted);
    previewMutedRef.current = nextMuted;
    previewVolumeRef.current = nextVolume;
    applyPreviewGain();
    applyMusicGain();
  }

  function changePreviewVolume(value: number) {
    const nextVolume = Math.max(0, Math.min(value, 1));
    const nextMuted = nextVolume === 0;
    setPreviewVolume(nextVolume);
    setPreviewMuted(nextMuted);
    previewMutedRef.current = nextMuted;
    previewVolumeRef.current = nextVolume;
    applyPreviewGain();
  }

  function changeMusicVolume(value: number) {
    if (!backgroundMusic) return;
    const clamped = Math.max(0, Math.min(value, 1));
    setMusicVolumeDraft(clamped);
    // Unmute so the user hears the bed while dragging the slider.
    if (previewMutedRef.current && clamped > 0) {
      setPreviewMuted(false);
      previewMutedRef.current = false;
    }
    const next = { ...backgroundMusic, volume: clamped };
    setBackgroundMusic(next);
    applyMusicGain(next);
    if (musicVolumeSaveTimerRef.current != null) {
      window.clearTimeout(musicVolumeSaveTimerRef.current);
    }
    musicVolumeSaveTimerRef.current = window.setTimeout(() => {
      musicVolumeSaveTimerRef.current = null;
      void savePreviewMusicVolume(clamped);
    }, 350);
  }

  async function savePreviewMusicVolume(volume: number) {
    const clamped = Math.max(0, Math.min(volume, 1));
    setMusicVolumeSaving(true);
    try {
      const next = await saveBackgroundMusic(projectId, { volume: clamped });
      setBackgroundMusic(next);
      setMusicVolumeDraft(null);
      applyMusicGain(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el volumen de la música');
    } finally {
      setMusicVolumeSaving(false);
    }
  }

  useEffect(() => {
    previewMutedRef.current = previewMuted;
    previewVolumeRef.current = previewVolume;
    applyPreviewGain();
  }, [previewMuted, previewVolume]);

  useEffect(() => {
    applyMusicGain(backgroundMusic);
  }, [backgroundMusic]);

  useEffect(() => {
    let cancelled = false;
    getBackgroundMusic(projectId)
      .then((data) => {
        if (!cancelled) setBackgroundMusic(data);
      })
      .catch(() => {
        if (!cancelled) setBackgroundMusic(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const video = videoRef.current;
    const previewAudio = audioRef.current;
    if (!video || !activeReel) return;
    const syncedVideo: HTMLVideoElement = video;
    const syncedAudio = previewAudio;

    function onTimeUpdate() {
      if (!video || jumpingRef.current) return;
      setSourceTime(video.currentTime);
      if (scrubbingRef.current) return;
      if (!previewingRef.current || !activeReel) return;
      const ordered = [...activeReel.segments].sort((a, b) => a.order - b.order);
      const index = previewIndexRef.current;
      const current = ordered[index];
      if (!current) {
        stopPreview();
        return;
      }
      const elapsedBefore = ordered
        .slice(0, index)
        .reduce((sum, segment) => sum + Math.max(0, segment.duration_seconds), 0);
      setPreviewOutputTime(
        Math.max(
          0,
          elapsedBefore +
            Math.min(
              Math.max(0, video.currentTime - current.source_start_seconds),
              current.duration_seconds,
            ),
        ),
      );
      const outputNow =
        elapsedBefore +
        Math.min(
          Math.max(0, video.currentTime - current.source_start_seconds),
          current.duration_seconds,
        );
      if (usesSeparateAudio()) syncAudioToVideo(video.currentTime);
      syncMusicToOutput(outputNow);
      if (video.currentTime >= current.source_end_seconds - 0.04) {
        const nextIndex = index + 1;
        if (nextIndex >= ordered.length) {
          stopPreview();
          return;
        }
        previewIndexRef.current = nextIndex;
        setPreviewIndex(nextIndex);
        void jumpPreviewToSource(ordered[nextIndex].source_start_seconds, true);
      }
    }

    function onSeeking() {
      if (!scrubbingRef.current && !jumpingRef.current && usesSeparateAudio()) {
        syncAudioToVideo(syncedVideo.currentTime, true);
      }
    }

    function onVideoMetadata() {
      if (pendingVideoTimeRef.current != null) {
        if (setMediaTime(syncedVideo, pendingVideoTimeRef.current)) {
          pendingVideoTimeRef.current = null;
        }
      }
    }

    function onAudioMetadata() {
      if (!syncedAudio || pendingAudioTimeRef.current == null) return;
      if (setMediaTime(syncedAudio, pendingAudioTimeRef.current)) {
        pendingAudioTimeRef.current = null;
      }
    }

    syncedVideo.addEventListener('timeupdate', onTimeUpdate);
    syncedVideo.addEventListener('seeking', onSeeking);
    syncedVideo.addEventListener('loadedmetadata', onVideoMetadata);
    syncedAudio?.addEventListener('loadedmetadata', onAudioMetadata);
    return () => {
      syncedVideo.removeEventListener('timeupdate', onTimeUpdate);
      syncedVideo.removeEventListener('seeking', onSeeking);
      syncedVideo.removeEventListener('loadedmetadata', onVideoMetadata);
      syncedAudio?.removeEventListener('loadedmetadata', onAudioMetadata);
    };
  }, [activeReel]);

  const orderedSegments = useMemo(
    () => (activeReel ? [...activeReel.segments].sort((a, b) => a.order - b.order) : []),
    [activeReel],
  );
  const outputClock = useMemo(() => buildOutputClock(orderedSegments), [orderedSegments]);
  const selectedOverlay =
    overlays.find((item) => item.id === selectedOverlayId) ?? null;
  const previewIdentity = previewTimelineIdentity(activeReel?.id, orderedSegments);

  useEffect(() => {
    previewingRef.current = false;
    setPreviewing(false);
    previewIndexRef.current = 0;
    setPreviewIndex(0);
    setPreviewOutputTime(0);

    const video = videoRef.current;
    const audio = audioRef.current;
    const first = orderedSegments[0];
    if (!video || !first) {
      setSourceTime(null);
      return;
    }
    video.pause();
    audio?.pause();
    const showFirstFrame = () => {
      video.currentTime = first.source_start_seconds;
      applyPreviewGain();
      if (usesSeparateAudio() && audio) {
        syncAudioToVideo(first.source_start_seconds, true);
      }
      setSourceTime(first.source_start_seconds);
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      showFirstFrame();
    } else {
      video.addEventListener('loadedmetadata', showFirstFrame, { once: true });
      return () => video.removeEventListener('loadedmetadata', showFirstFrame);
    }
  }, [previewIdentity]); // eslint-disable-line react-hooks/exhaustive-deps -- do not reset on metadata-only Reel updates

  useEffect(() => {
    void listAssets(projectId)
      .then((response) => setAssets(response.items))
      .catch(() => setAssets([]));
  }, [projectId]);

  useEffect(() => {
    if (!activeReel?.id) {
      setOverlays([]);
      setSelectedOverlayId(null);
      setAssembledPreviewSrc(null);
      setPreviewMode('logical');
      return;
    }
    void reloadOverlays(activeReel.id);
    setAssembledPreviewSrc(null);
    setPreviewMode('logical');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when reel id changes
  }, [activeReel?.id, projectId]);

  useEffect(
    () => () => {
      if (seekAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(seekAnimationFrameRef.current);
      }
      if (audioOffsetSeekTimerRef.current != null) {
        window.clearTimeout(audioOffsetSeekTimerRef.current);
      }
      if (musicVolumeSaveTimerRef.current != null) {
        window.clearTimeout(musicVolumeSaveTimerRef.current);
      }
      if (segmentPersistTimerRef.current != null) {
        window.clearTimeout(segmentPersistTimerRef.current);
      }
      if (overlayPersistTimerRef.current != null) {
        window.clearTimeout(overlayPersistTimerRef.current);
      }
    },
    [],
  );

  const timedTranscript = transcriptSegments.filter(
    (s) => s.start_seconds != null && s.end_seconds != null,
  );

  useEffect(() => {
    if (orderedSegments.length === 0) {
      if (editingSegmentId != null) setEditingSegmentId(null);
      return;
    }
    if (!editingSegmentId || !orderedSegments.some((item) => item.id === editingSegmentId)) {
      setEditingSegmentId(orderedSegments[0].id);
    }
  }, [orderedSegments, editingSegmentId]);

  const selectedSegment =
    orderedSegments.find((item) => item.id === editingSegmentId) ?? orderedSegments[0] ?? null;

  const captionLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const segment of orderedSegments) {
      labels[segment.id] =
        transcriptDrafts[segment.id] ?? fragmentCaptionBaseline(segment, timedTranscript);
    }
    return labels;
  }, [orderedSegments, timedTranscript, transcriptDrafts]);

  function selectTimelineSegment(segmentId: string, track: TimelineTrackKind) {
    setEditingSegmentId(segmentId);
    setSelectedOverlayId(null);
    if (track === 'captions') setActiveTool('subtitles');
    else if (track === 'video') setActiveTool('cuts');
  }

  function selectTimelineOverlay(overlayId: string) {
    setSelectedOverlayId(overlayId);
    setActiveTool('cuts');
  }

  const nleActive = Boolean(activeReel);

  return (
    <section className={`card reel-editor${nleActive ? ' reel-editor--nle' : ''}`}>
      {!nleActive && (
        <>
          <div className="transcript-editor__header">
            <h2>Editor de Reel</h2>
          </div>
          <p className="muted">
            Crea o elige un Reel. El editor muestra vista previa, inspector y línea temporal.
          </p>
        </>
      )}

      {loading && <p className="muted">Cargando Reels…</p>}
      {error && !activeReel && <p className="error">{error}</p>}

      {!activeReel && reels.length > 0 && (
        <div className="reel-selection">
          <h3>Selecciona un Reel</h3>
          <div className="reel-tabs" aria-label="Reels del proyecto">
            {reels.map((reel, index) => (
              <button
                key={reel.id}
                type="button"
                aria-pressed={reel.id === activeReelId}
                className={`reel-tab${reel.id === activeReelId ? ' reel-tab--active' : ''}`}
                onClick={() => {
                  stopPreview();
                  setEditingSegmentId(null);
                  setActiveReelId(reel.id);
                  setAspect(reel.aspect_ratio);
                }}
              >
                <strong>
                  {index + 1}. {reel.title}
                </strong>
                <span>
                  {reel.segments.length} frag. · {formatDuration(reel.content_duration_seconds)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!activeReel && (
        <div id="reel-tool-panel-cuts-create">
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
          </div>
        </div>
      )}

      {activeReel && (
        <>
          <div className="reel-nle__top">
            <div className="reel-nle__reel-bar">
              <div className="reel-nle__reel-title">
                <strong>
                  {reels.findIndex((reel) => reel.id === activeReel.id) + 1}. {activeReel.title}
                </strong>
                <span className={`badge badge--${activeReel.status}`}>{activeReel.status}</span>
                <span className="muted">
                  {formatDuration(activeReel.content_duration_seconds)} · {activeReel.aspect_ratio}
                </span>
              </div>
              <div className="reel-nle__reel-actions">
                {reels.length > 1 && (
                  <label className="reel-nle__reel-picker">
                    <span className="visually-hidden">Cambiar Reel</span>
                    <select
                      aria-label="Reel en edición"
                      value={activeReel.id}
                      onChange={(event) => {
                        const reel = reels.find((item) => item.id === event.target.value);
                        if (!reel) return;
                        stopPreview();
                        setEditingSegmentId(null);
                        setActiveReelId(reel.id);
                        setAspect(reel.aspect_ratio);
                      }}
                    >
                      {reels.map((reel, index) => (
                        <option key={reel.id} value={reel.id}>
                          {index + 1}. {reel.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="button button--inline button--danger"
                  onClick={() => setConfirmDeleteReel(true)}
                  disabled={busy}
                >
                  Eliminar
                </button>
              </div>
            </div>
            <nav className="reel-nle__tools" aria-label="Herramientas del editor">
              <div className="reel-nle__tools-track" role="tablist">
                {REEL_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    id={`reel-tool-tab-${tool.id}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTool === tool.id}
                    aria-controls={`reel-tool-panel-${tool.id}`}
                    className={`reel-nle__tool${
                      activeTool === tool.id ? ' reel-nle__tool--active' : ''
                    }`}
                    onClick={() => {
                      setActiveTool(tool.id);
                      window.requestAnimationFrame(pinWorkspaceNav);
                    }}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>
            </nav>
            {error && <p className="error editor-sticky-notice">{error}</p>}
          </div>

          <div className={`reel-nle__main reel-nle__main--${activeTool}`}>
            <div className="reel-nle__workspace">
              <MediaBinPanel
                projectId={projectId}
                assets={assets}
                onAssetsChange={setAssets}
                onAddTextAtPlayhead={() => void handleAddTextOverlay(previewOutputTime)}
              />
            <div className="reel-nle__stage">
              {hasVideo && orderedSegments.length > 0 ? (
                <div className="reel-nle__preview">
                  <div
                    className={`reel-player reel-player--${
                      activeReel.aspect_ratio === '9:16'
                        ? 'portrait'
                        : activeReel.aspect_ratio === '1:1'
                          ? 'square'
                          : 'landscape'
                    }`}
                  >
                    <div className="reel-player__stage">
                      <video
                        ref={videoRef}
                        className="reel-player__video"
                        controls={false}
                        disablePictureInPicture
                        playsInline
                        preload="auto"
                        src={projectVideoUrl(projectId, mediaRevision)}
                        hidden={previewMode === 'assembled'}
                      >
                        Tu navegador no soporta video HTML5.
                      </video>
                      {assembledPreviewSrc && (
                        <video
                          ref={assembledVideoRef}
                          className="reel-player__video"
                          controls={false}
                          disablePictureInPicture
                          playsInline
                          preload="auto"
                          src={assembledPreviewSrc}
                          hidden={previewMode !== 'assembled'}
                          onTimeUpdate={(event) => {
                            if (previewMode !== 'assembled' || scrubbingRef.current) return;
                            setPreviewOutputTime((event.target as HTMLVideoElement).currentTime);
                          }}
                        >
                          Tu navegador no soporta video HTML5.
                        </video>
                      )}
                      {previewMode === 'logical' && (
                        <OverlayPreviewLayer
                          overlays={overlays}
                          outputTime={previewOutputTime}
                        />
                      )}
                      <div id="reel-subtitle-overlay" className="reel-player__subtitle-slot" />
                    </div>
                  </div>
                  <audio
                    ref={audioRef}
                    preload="auto"
                    src={projectVideoUrl(projectId, mediaRevision)}
                    aria-hidden="true"
                  />
                  {musicPreviewActive() && backgroundMusic?.music_filename && (
                    <audio
                      ref={musicRef}
                      preload="auto"
                      src={backgroundMusicAudioUrl(projectId, backgroundMusic.music_filename)}
                      aria-hidden="true"
                    />
                  )}
                  <div className="reel-nle__transport">
                    <button
                      type="button"
                      onClick={() => {
                        if (previewMode === 'assembled') {
                          const video = assembledVideoRef.current;
                          if (!video) return;
                          if (previewing) {
                            video.pause();
                            previewingRef.current = false;
                            setPreviewing(false);
                          } else {
                            previewingRef.current = true;
                            setPreviewing(true);
                            void video.play().catch((err: unknown) => {
                              previewingRef.current = false;
                              setPreviewing(false);
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : 'El navegador bloqueó la reproducción',
                              );
                            });
                          }
                          return;
                        }
                        if (previewing) stopPreview();
                        else startPreview();
                      }}
                    >
                      {previewing ? 'Pausar' : 'Reproducir'}
                    </button>
                    <input
                      type="range"
                      className="reel-nle__scrub"
                      min={0}
                      max={Math.max(
                        previewMode === 'assembled'
                          ? outputClock.totalDuration
                          : activeReel.content_duration_seconds,
                        0.01,
                      )}
                      step={0.01}
                      value={Math.min(
                        previewOutputTime,
                        previewMode === 'assembled'
                          ? outputClock.totalDuration
                          : activeReel.content_duration_seconds,
                      )}
                      aria-label="Posición dentro del Reel"
                      onChange={(event) => seekPreview(Number(event.target.value))}
                      onPointerDown={beginPreviewScrub}
                      onPointerUp={endPreviewScrub}
                      onPointerCancel={endPreviewScrub}
                      onBlur={endPreviewScrub}
                    />
                    <span className="reel-nle__time">
                      {formatDuration(previewOutputTime)} /{' '}
                      {formatDuration(
                        previewMode === 'assembled'
                          ? outputClock.totalDuration
                          : activeReel.content_duration_seconds,
                      )}
                    </span>
                    <div className="reel-nle__preview-mode" role="group" aria-label="Modo de vista previa">
                      <button
                        type="button"
                        className={`button button--secondary${
                          previewMode === 'logical' ? ' button--pressed' : ''
                        }`}
                        aria-pressed={previewMode === 'logical'}
                        disabled={assembledBusy}
                        onClick={() => void switchPreviewMode('logical')}
                      >
                        Vista lógica
                      </button>
                      <button
                        type="button"
                        className={`button button--secondary${
                          previewMode === 'assembled' ? ' button--pressed' : ''
                        }`}
                        aria-pressed={previewMode === 'assembled'}
                        disabled={assembledBusy}
                        onClick={() => void switchPreviewMode('assembled')}
                      >
                        {assembledBusy ? 'Ensamblando…' : 'Ensamblado'}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="button button--secondary"
                      aria-pressed={previewMuted}
                      onClick={togglePreviewAudio}
                    >
                      {previewMuted ? 'Audio' : 'Silenciar'}
                    </button>
                  </div>
                  <div className="reel-nle__mix">
                    <label className="reel-nle__mix-slider">
                      <span>Voz</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={previewMuted ? 0 : previewVolume}
                        aria-label="Volumen de la voz"
                        onChange={(event) => changePreviewVolume(Number(event.target.value))}
                      />
                      <em>{Math.round((previewMuted ? 0 : previewVolume) * 100)}%</em>
                    </label>
                    <label
                      className={`reel-nle__mix-slider${
                        backgroundMusic?.music_filename && backgroundMusic.preset !== 'none'
                          ? ''
                          : ' reel-nle__mix-slider--disabled'
                      }`}
                    >
                      <span>Música</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={
                          musicVolumeDraft ??
                          backgroundMusic?.volume ??
                          0
                        }
                        disabled={
                          !backgroundMusic?.music_filename ||
                          backgroundMusic.preset === 'none' ||
                          !backgroundMusic.enabled
                        }
                        aria-label="Volumen de la música"
                        onChange={(event) => changeMusicVolume(Number(event.target.value))}
                        onPointerUp={(event) => {
                          if (musicVolumeSaveTimerRef.current != null) {
                            window.clearTimeout(musicVolumeSaveTimerRef.current);
                            musicVolumeSaveTimerRef.current = null;
                          }
                          void savePreviewMusicVolume(
                            Number((event.target as HTMLInputElement).value),
                          );
                        }}
                      />
                      <em>
                        {backgroundMusic?.music_filename &&
                        backgroundMusic.preset !== 'none' &&
                        backgroundMusic.enabled
                          ? `${Math.round((musicVolumeDraft ?? backgroundMusic.volume) * 100)}%${
                              musicVolumeSaving ? '…' : ''
                            }`
                          : '—'}
                      </em>
                    </label>
                  </div>
                </div>
              ) : (
                <div className="reel-nle__stage-empty">
                  <p className="muted">
                    {hasVideo
                      ? 'Añade al menos un fragmento para ver la vista previa.'
                      : 'Carga un video del proyecto para previsualizar el Reel.'}
                  </p>
                </div>
              )}
            </div>

            <aside className={`reel-nle__inspector reel-nle__inspector--${activeTool}`}>
              <div
                id="reel-tool-panel-cuts"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-cuts"
                hidden={activeTool !== 'cuts'}
              >
                <div className="reel-nle__inspector-section reel-nle__cuts-workspace">
                  <div className="reel-nle__cuts-toolbar">
                    <h3 className="reel-nle__cuts-title">Edición de cortes</h3>
                    <div className="button-stack">
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => openAddFragmentForm()}
                        disabled={busy}
                      >
                        Añadir fragmento
                      </button>
                      <button type="button" onClick={() => void handleSaveTitle()} disabled={busy}>
                        Metadatos
                      </button>
                    </div>
                  </div>

                  {showAddFragment && (
                    <div className="reel-add-fragment">
                      <p className="reel-add-fragment__title">Nuevo fragmento</p>
                      <p className="muted reel-add-fragment__hint">
                        Duración:{' '}
                        {formatDuration(Math.max(0, addFragmentEnd - addFragmentStart))}
                        {videoDuration != null ? ` · Video ${formatDuration(videoDuration)}` : ''}
                      </p>
                      <div className="reel-add-fragment__row">
                        <label className="field field--inline">
                          <span>Inicio (s)</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={addFragmentStart}
                            disabled={busy}
                            onChange={(event) => setAddFragmentStart(Number(event.target.value))}
                          />
                        </label>
                        <button
                          type="button"
                          className="button button--inline"
                          disabled={busy || sourceTime == null}
                          onClick={() =>
                            sourceTime != null && setAddFragmentStart(round3(sourceTime))
                          }
                        >
                          Tiempo actual
                        </button>
                      </div>
                      <div className="reel-add-fragment__row">
                        <label className="field field--inline">
                          <span>Fin (s)</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={addFragmentEnd}
                            disabled={busy}
                            onChange={(event) => setAddFragmentEnd(Number(event.target.value))}
                          />
                        </label>
                        <button
                          type="button"
                          className="button button--inline"
                          disabled={busy || sourceTime == null}
                          onClick={() => sourceTime != null && setAddFragmentEnd(round3(sourceTime))}
                        >
                          Tiempo actual
                        </button>
                      </div>
                      <div className="reel-add-fragment__actions">
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() => void handleAddManualFragment()}
                        >
                          Añadir
                        </button>
                        <button
                          type="button"
                          className="button button--secondary"
                          disabled={busy}
                          onClick={() => setShowAddFragment(false)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="reel-nle__filmstrip" aria-label="Fragmentos del Reel">
                    {orderedSegments.map((segment, index) => {
                      const selected = selectedSegment?.id === segment.id;
                      return (
                        <button
                          key={segment.id}
                          type="button"
                          className={`reel-nle__filmstrip-item${
                            selected ? ' reel-nle__filmstrip-item--selected' : ''
                          }`}
                          onClick={() => {
                            setEditingSegmentId(segment.id);
                            setSelectedOverlayId(null);
                            const placement = outputClock.placements[index];
                            seekPreview(placement?.outputStart ?? 0);
                          }}
                        >
                          <strong>{index + 1}</strong>
                          <span>{formatDuration(segment.duration_seconds)}</span>
                          <small>
                            {formatTimecode(segment.source_start_seconds)}–
                            {formatTimecode(segment.source_end_seconds)}
                          </small>
                        </button>
                      );
                    })}
                    {orderedSegments.length === 0 && (
                      <p className="muted">Aún no hay fragmentos. Añade uno para editarlo.</p>
                    )}
                  </div>

                  {selectedSegment &&
                    (() => {
                      const segment = selectedSegment;
                      const index = orderedSegments.findIndex((item) => item.id === segment.id);
                      const next = orderedSegments[index + 1];
                      const gap = next ? gapSeconds(segment, next) : null;
                      const baseline = fragmentCaptionBaseline(segment, timedTranscript);
                      const draft = transcriptDrafts[segment.id] ?? baseline;
                      const dirty = draft !== baseline;
                      const saving = transcriptSavingId === segment.id;
                      const hasCustom = Boolean(segment.transcript_text?.trim());
                      return (
                        <div className="reel-nle__selected-clip reel-nle__selected-clip--roomy">
                          <div className="reel-nle__selected-clip-header">
                            <div>
                              <h4>Fragmento {index + 1}</h4>
                              <p className="muted">
                                {formatTimecode(segment.source_start_seconds)} –{' '}
                                {formatTimecode(segment.source_end_seconds)}
                                {' · '}
                                {formatDuration(segment.duration_seconds)}
                                {gap != null && Math.abs(gap) > 0.05
                                  ? gap > 0
                                    ? ` · salto ${formatDuration(gap)}`
                                    : ` · solapa ${formatDuration(Math.abs(gap))}`
                                  : ''}
                              </p>
                            </div>
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
                                className="button button--inline button--danger"
                                onClick={() => void handleRemoveSegment(segment.id)}
                                disabled={busy}
                              >
                                Quitar
                              </button>
                            </div>
                          </div>

                          <div className="reel-transcript-form reel-transcript-form--editor">
                            <p className="reel-transcript-form__label">Subtítulo de este fragmento</p>
                            <textarea
                              className="reel-transcript-form__input"
                              rows={8}
                              value={draft}
                              disabled={saving || busy}
                              placeholder="Texto que debe verse en este fragmento…"
                              onChange={(event) =>
                                setTranscriptDrafts((current) => ({
                                  ...current,
                                  [segment.id]: event.target.value,
                                }))
                              }
                              onBlur={(event) => {
                                const value = event.target.value;
                                if (value.trim() && value !== baseline) {
                                  void saveFragmentCaption(segment, value);
                                }
                              }}
                            />
                            <div className="reel-transcript-form__actions">
                              <button
                                type="button"
                                className="button"
                                disabled={saving || busy || !dirty || !draft.trim()}
                                onClick={() => void saveFragmentCaption(segment)}
                              >
                                {saving ? 'Guardando…' : dirty ? 'Guardar subtítulo' : 'Guardado'}
                              </button>
                              {hasCustom && (
                                <button
                                  type="button"
                                  className="button button--secondary"
                                  disabled={saving || busy}
                                  onClick={() => void clearFragmentCaption(segment)}
                                >
                                  Texto del video
                                </button>
                              )}
                              <button
                                type="button"
                                className="button button--secondary"
                                onClick={() => setActiveTool('subtitles')}
                              >
                                Estilo de subtítulos
                              </button>
                            </div>
                          </div>

                          <div className="reel-segment-edit reel-segment-edit--roomy">
                            <div className="reel-adjust">
                              <span>Inicio</span>
                              <input
                                type="number"
                                step="0.01"
                                defaultValue={segment.source_start_seconds}
                                key={`start-${segment.id}-${segment.source_start_seconds}`}
                                onBlur={(e) => {
                                  const nextVal = Number(e.target.value);
                                  if (
                                    Number.isFinite(nextVal) &&
                                    nextVal !== segment.source_start_seconds
                                  ) {
                                    void handleSegmentField(segment, {
                                      source_start_seconds: nextVal,
                                    });
                                  }
                                }}
                              />
                              {ADJUST_STEPS.map((step) => (
                                <button
                                  key={`start-${step}`}
                                  type="button"
                                  className="button button--inline"
                                  disabled={busy}
                                  onClick={() => void adjustEdge(segment, 'start', step)}
                                >
                                  {step > 0 ? `+${step}` : step}s
                                </button>
                              ))}
                            </div>
                            <div className="reel-adjust">
                              <span>Fin</span>
                              <input
                                type="number"
                                step="0.01"
                                defaultValue={segment.source_end_seconds}
                                key={`end-${segment.id}-${segment.source_end_seconds}`}
                                onBlur={(e) => {
                                  const nextVal = Number(e.target.value);
                                  if (
                                    Number.isFinite(nextVal) &&
                                    nextVal !== segment.source_end_seconds
                                  ) {
                                    void handleSegmentField(segment, {
                                      source_end_seconds: nextVal,
                                    });
                                  }
                                }}
                              />
                              {ADJUST_STEPS.map((step) => (
                                <button
                                  key={`end-${step}`}
                                  type="button"
                                  className="button button--inline"
                                  disabled={busy}
                                  onClick={() => void adjustEdge(segment, 'end', step)}
                                >
                                  {step > 0 ? `+${step}` : step}s
                                </button>
                              ))}
                            </div>
                            <label className="field field--inline">
                              <span>Transición al siguiente</span>
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
                                <span>Duración (ms)</span>
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

                          <CutSuggestionMarkers
                            suggestions={cutReport?.suggestions ?? []}
                            segmentUuid={segment.id}
                            busy={cutBusy || busy}
                            onAccept={(suggestion) => void handleAcceptCut(suggestion)}
                            onReject={(suggestion) => void handleRejectCut(suggestion)}
                          />
                        </div>
                      );
                    })()}

                  {selectedOverlay && (
                    <div className="reel-nle__selected-clip reel-nle__overlay-inspector">
                      <div className="reel-nle__selected-clip-header">
                        <div>
                          <h4>
                            Overlay {selectedOverlay.kind === 'text' ? 'texto' : 'imagen'}
                          </h4>
                          <p className="muted">
                            {formatDuration(selectedOverlay.start_ms / 1000)} ·{' '}
                            {formatDuration(selectedOverlay.duration_ms / 1000)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="button button--inline button--danger"
                          disabled={busy}
                          onClick={() => void handleDeleteOverlay(selectedOverlay.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                      <div className="reel-segment-edit reel-segment-edit--roomy">
                        <label className="field field--inline">
                          <span>Inicio (ms)</span>
                          <input
                            type="number"
                            min={0}
                            step={50}
                            value={selectedOverlay.start_ms}
                            disabled={busy}
                            onChange={(event) =>
                              void handleOverlayField(selectedOverlay, {
                                start_ms: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="field field--inline">
                          <span>Duración (ms)</span>
                          <input
                            type="number"
                            min={100}
                            step={50}
                            value={selectedOverlay.duration_ms}
                            disabled={busy}
                            onChange={(event) =>
                              void handleOverlayField(selectedOverlay, {
                                duration_ms: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        {selectedOverlay.kind === 'text' && (
                          <label className="field">
                            <span>Texto</span>
                            <textarea
                              rows={3}
                              value={selectedOverlay.text ?? ''}
                              disabled={busy}
                              onChange={(event) =>
                                void handleOverlayField(selectedOverlay, {
                                  text: event.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                        <label className="field field--inline">
                          <span>Escala</span>
                          <input
                            type="number"
                            min={0.1}
                            max={4}
                            step={0.05}
                            value={selectedOverlay.scale}
                            disabled={busy}
                            onChange={(event) =>
                              void handleOverlayField(selectedOverlay, {
                                scale: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="field field--inline">
                          <span>Opacidad</span>
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={selectedOverlay.opacity}
                            disabled={busy}
                            onChange={(event) =>
                              void handleOverlayField(selectedOverlay, {
                                opacity: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  <details className="reel-nle__details">
                    <summary>Sugerencias de corte y transcripción</summary>
                    <CutSuggestionsPanel
                      projectId={projectId}
                      reelId={activeReel.id}
                      segmentIds={orderedSegments.map((segment) => segment.id)}
                      onReelChange={replaceReel}
                      onReportChange={setCutReport}
                    />
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
                    </div>
                    <div className="button-stack">
                      <button
                        type="button"
                        onClick={() => void handleCreateEmpty()}
                        disabled={busy}
                      >
                        Nuevo Reel vacío
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCreateFromSelection()}
                        disabled={busy || selectedTranscriptIds.length === 0}
                      >
                        Crear desde selección
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => void handleAppendFromSelection()}
                        disabled={busy || selectedTranscriptIds.length === 0}
                      >
                        Añadir selección
                      </button>
                    </div>
                    <div className="reel-picker">
                      {timedTranscript.length === 0 ? (
                        <p className="muted">Sin transcripción temporizada.</p>
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
                    </div>
                  </details>
                </div>
              </div>

              <div
                id="reel-tool-panel-framing"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-framing"
                hidden={activeTool !== 'framing'}
              >
                <FramingPanel
                  projectId={projectId}
                  reel={activeReel}
                  sourceTime={sourceTime}
                  onReelChange={replaceReel}
                  compact
                />
              </div>

              <div
                id="reel-tool-panel-subtitles"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-subtitles"
                hidden={activeTool !== 'subtitles'}
              >
                <SubtitlePanel
                  projectId={projectId}
                  reel={activeReel}
                  sourceTime={sourceTime}
                  previewSegmentIndex={orderedSegments.length > 0 ? previewIndex : null}
                  onReelUpdated={replaceReel}
                  hideStagePreview
                />
              </div>

              <div
                id="reel-tool-panel-audio"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-audio"
                hidden={activeTool !== 'audio'}
              >
                <div className="reel-audio-sync reel-audio-sync--inspector">
                  <div className="reel-audio-sync__header">
                    <label htmlFor={`audio-sync-${activeReel.id}`}>
                      Sincronía voz:{' '}
                      <strong>
                        {audioOffsetMs === 0
                          ? '0 ms'
                          : audioOffsetMs > 0
                            ? `+${audioOffsetMs} ms`
                            : `${audioOffsetMs} ms`}
                      </strong>
                    </label>
                    <div className="button-stack">
                      <button
                        type="button"
                        className="button button--inline"
                        disabled={
                          audioOffsetSaving || audioOffsetMs === (activeReel.audio_offset_ms ?? 0)
                        }
                        onClick={() => void saveAudioOffset()}
                      >
                        {audioOffsetSaving ? '…' : 'Guardar'}
                      </button>
                      <button
                        type="button"
                        className="button button--inline"
                        disabled={audioOffsetSaving || audioOffsetMs === 0}
                        onClick={() => {
                          applyAudioOffset(0);
                          void saveAudioOffset(0);
                        }}
                      >
                        0
                      </button>
                    </div>
                  </div>
                  <input
                    id={`audio-sync-${activeReel.id}`}
                    type="range"
                    min={-1000}
                    max={1000}
                    step={10}
                    value={audioOffsetMs}
                    onChange={(event) => applyAudioOffset(Number(event.target.value))}
                    onPointerUp={commitAudioOffsetPreview}
                    onPointerCancel={commitAudioOffsetPreview}
                    onKeyUp={commitAudioOffsetPreview}
                    onBlur={commitAudioOffsetPreview}
                  />
                  <p className="muted">
                    Solo el audio del video; la música de fondo no se desplaza.
                  </p>
                </div>
                <BackgroundMusicPanel
                  projectId={projectId}
                  compact
                  onSettingsChange={(settings) => {
                    setBackgroundMusic(settings);
                    applyMusicGain(settings);
                  }}
                />
              </div>

              <div
                id="reel-tool-panel-end-card"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-end-card"
                hidden={activeTool !== 'end-card'}
              >
                <EndCardPanel
                  projectId={projectId}
                  aspectRatio={activeReel.aspect_ratio}
                  hasCover={hasCover}
                  onCoverUpdated={onCoverUpdated}
                />
              </div>

              <div
                id="reel-tool-panel-export"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-export"
                hidden={activeTool !== 'export'}
              >
                <RenderPanel
                  projectId={projectId}
                  reelId={activeReel.id}
                  reelAspectRatio={activeReel.aspect_ratio}
                  segments={activeReel.segments}
                  audioOffsetMs={audioOffsetMs}
                  onReelChange={replaceReel}
                  onBeforeStart={flushCaptionDraftsForExport}
                  onGoToCuts={() => setActiveTool('cuts')}
                />
              </div>
            </aside>
            </div>
          </div>

          <ReelTimelineStrip
            segments={orderedSegments}
            overlays={overlays}
            totalDuration={outputClock.totalDuration}
            outputTime={previewOutputTime}
            selectedSegmentId={selectedSegment?.id ?? null}
            selectedOverlayId={selectedOverlayId}
            captionLabels={captionLabels}
            musicActive={musicPreviewActive()}
            musicLabel={
              backgroundMusic?.music_filename
                ? backgroundMusic.music_filename.replace(/\.[^.]+$/, '')
                : 'Música'
            }
            pxPerSecond={timelineZoom}
            onZoomChange={setTimelineZoom}
            onSeek={seekPreview}
            onScrubStart={beginPreviewScrub}
            onScrubEnd={endPreviewScrub}
            onSelectSegment={selectTimelineSegment}
            onSelectOverlay={selectTimelineOverlay}
            onSelectMusic={() => setActiveTool('audio')}
            onReorderSegments={handleReorderSegments}
            onTrimSegment={handleTrimSegment}
            onMoveOverlay={handleMoveOverlay}
            onDropAsset={(assetId, outputSeconds) => void handleDropAsset(assetId, outputSeconds)}
            onAddTextOverlay={(outputSeconds) => void handleAddTextOverlay(outputSeconds)}
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
