import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Captions, Download, Image, Music, Scissors, Square } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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
import type { ProjectAsset } from '../types/asset';
import type { ReelOverlay } from '../types/overlay';
import type { Project } from '../types/project';
import type { AspectRatio, Reel, ReelSegment, TransitionType } from '../types/reel';
import type { TranscriptSegment } from '../types/transcript';
import { formatDuration, formatTimecode } from '../utils/format';
import { buildOutputClock, outputTimeAtSource, outputTimeForSource, sourceWindowsContiguous } from '../utils/reelOutputClock';
import { clampRippleTrim } from '../utils/reelTrim';
import { buildSourceGaps } from '../utils/reelTimelineStrip';
import { useNleLayout } from '../utils/useNleLayout';
import { ConfirmDialog } from './ConfirmDialog';
import { CutSuggestionsPanel } from './CutSuggestionsPanel';
import { BackgroundMusicPanel } from './BackgroundMusicPanel';
import { EndCardPanel } from './EndCardPanel';
import { FramingPanel } from './FramingPanel';
import { MediaBinPanel } from './MediaBinPanel';
import { AddFragmentForm } from './nle/AddFragmentForm';
import { ClipInspector } from './nle/ClipInspector';
import { CutsFilmstrip } from './nle/CutsFilmstrip';
import { NleSplitter } from './nle/NleSplitter';
import { OmittedGapInspector } from './nle/OmittedGapInspector';
import { OverlayInspector } from './nle/OverlayInspector';
import { PreviewMonitor } from './nle/PreviewMonitor';
import { PreviewTransport } from './nle/PreviewTransport';
import { SourceMonitor } from './nle/SourceMonitor';
import { RenderPanel } from './RenderPanel';
import { CoherencePanel } from './CoherencePanel';
import { ReelTimelineStrip, type TimelineTrackKind } from './ReelTimelineStrip';
import { SubtitlePanel } from './SubtitlePanel';
import type { CutSuggestion, CutSuggestionsReport } from '../types/cutSuggestions';
import { acceptCutSuggestion, rejectCutSuggestion } from '../api/cutSuggestions';
import {
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
const REEL_TOOLS: {
  id: 'cuts' | 'framing' | 'subtitles' | 'audio' | 'end-card' | 'export';
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  { id: 'cuts', label: 'Cortes', description: 'Fragmentos y transiciones', icon: Scissors },
  { id: 'framing', label: 'Encuadre', description: 'Formato vertical', icon: Square },
  { id: 'subtitles', label: 'Subtítulos', description: 'Texto sobre imagen', icon: Captions },
  { id: 'audio', label: 'Audio', description: 'Sincronía y música', icon: Music },
  { id: 'end-card', label: 'Pantalla final', description: 'Imagen y llamado', icon: Image },
  { id: 'export', label: 'Exportar', description: 'Generar MP4', icon: Download },
];

type ReelTool = (typeof REEL_TOOLS)[number]['id'];

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
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
    const timer = window.setTimeout(finish, 420);
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
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const programLaneRef = useRef<0 | 1>(0);
  const [programLane, setProgramLane] = useState<0 | 1>(0);
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
  const [selectedGapKey, setSelectedGapKey] = useState<string | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(80);
  const [assembledPreviewSrc, setAssembledPreviewSrc] = useState<string | null>(null);
  const [assembledBusy, setAssembledBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState<'logical' | 'assembled'>('logical');
  const [binCollapsed, setBinCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const { layout, patchLayout } = useNleLayout();
  const musicVolumeSaveTimerRef = useRef<number | null>(null);
  const segmentPersistTimerRef = useRef<number | null>(null);
  const overlayPersistTimerRef = useRef<number | null>(null);
  const pendingSegmentWorkRef = useRef<(() => Promise<void>) | null>(null);
  const pendingOverlayWorkRef = useRef<(() => Promise<void>) | null>(null);
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
  const cutTimerRef = useRef<number | null>(null);
  const musicSyncRafRef = useRef<number | null>(null);
  const pendingMusicOutputRef = useRef<number | null>(null);
  const orderedSegmentsRef = useRef<ReelSegment[]>([]);
  const previewMutedRef = useRef(false);
  const previewVolumeRef = useRef(1);

  function programVideo(): HTMLVideoElement | null {
    return (programLaneRef.current === 0 ? videoARef : videoBRef).current;
  }

  function standbyVideo(): HTMLVideoElement | null {
    return (programLaneRef.current === 0 ? videoBRef : videoARef).current;
  }

  function clearCutTimer() {
    if (cutTimerRef.current != null) {
      window.clearTimeout(cutTimerRef.current);
      cutTimerRef.current = null;
    }
  }

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
      if (!draft) {
        if ((segment.transcript_text ?? '').trim()) {
          await clearFragmentCaption(segment);
        }
        continue;
      }
      if (draft === (segment.transcript_text ?? '').trim() && segment.transcript_text != null) {
        continue;
      }
      await saveFragmentCaption(segment, draft);
    }
  }

  async function flushPendingEditsForExport(): Promise<void> {
    if (musicVolumeSaveTimerRef.current != null) {
      window.clearTimeout(musicVolumeSaveTimerRef.current);
      musicVolumeSaveTimerRef.current = null;
    }
    const pendingMusicVolume = musicVolumeDraft ?? backgroundMusic?.volume;
    if (backgroundMusic && pendingMusicVolume != null) {
      await savePreviewMusicVolume(pendingMusicVolume);
    }
    if (activeReel && audioOffsetMs !== (activeReel.audio_offset_ms ?? 0)) {
      await saveAudioOffset();
    }
    await flushCaptionDraftsForExport();
    if (segmentPersistTimerRef.current != null) {
      window.clearTimeout(segmentPersistTimerRef.current);
      segmentPersistTimerRef.current = null;
    }
    const segmentWork = pendingSegmentWorkRef.current;
    pendingSegmentWorkRef.current = null;
    if (segmentWork) await segmentWork();
    if (overlayPersistTimerRef.current != null) {
      window.clearTimeout(overlayPersistTimerRef.current);
      overlayPersistTimerRef.current = null;
    }
    const overlayWork = pendingOverlayWorkRef.current;
    pendingOverlayWorkRef.current = null;
    if (overlayWork) await overlayWork();
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

  function debounceSegmentPersist(run: () => Promise<void>) {
    pendingSegmentWorkRef.current = run;
    if (segmentPersistTimerRef.current != null) {
      window.clearTimeout(segmentPersistTimerRef.current);
    }
    segmentPersistTimerRef.current = window.setTimeout(() => {
      segmentPersistTimerRef.current = null;
      const work = pendingSegmentWorkRef.current;
      pendingSegmentWorkRef.current = null;
      if (work) void work();
    }, 300);
  }

  function debounceOverlayPersist(run: () => Promise<void>) {
    pendingOverlayWorkRef.current = run;
    if (overlayPersistTimerRef.current != null) {
      window.clearTimeout(overlayPersistTimerRef.current);
    }
    overlayPersistTimerRef.current = window.setTimeout(() => {
      overlayPersistTimerRef.current = null;
      const work = pendingOverlayWorkRef.current;
      pendingOverlayWorkRef.current = null;
      if (work) void work();
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
    setReels((prev) =>
      prev.map((reel) => {
        if (reel.id !== activeReel.id) return reel;
        const byId = new Map(reel.segments.map((segment) => [segment.id, segment]));
        const reordered = orderedIds
          .map((id, order) => {
            const segment = byId.get(id);
            return segment ? { ...segment, order } : null;
          })
          .filter((segment): segment is ReelSegment => segment != null);
        return { ...reel, segments: reordered };
      }),
    );
    debounceSegmentPersist(async () => {
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
    });
  }

  function handleTrimSegment(
    id: string,
    patch: { source_start_seconds?: number; source_end_seconds?: number },
  ) {
    if (!activeReel) return;
    const clamped = clampRippleTrim(activeReel.segments, id, patch);
    if (!clamped) return;
    const nextPatch = {
      source_start_seconds: clamped.source_start_seconds,
      source_end_seconds: clamped.source_end_seconds,
    };
    setReels((prev) =>
      prev.map((reel) => {
        if (reel.id !== activeReel.id) return reel;
        return {
          ...reel,
          segments: reel.segments.map((segment) =>
            segment.id === id
              ? {
                  ...segment,
                  ...nextPatch,
                  duration_seconds: Math.max(
                    0,
                    nextPatch.source_end_seconds - nextPatch.source_start_seconds,
                  ),
                }
              : segment,
          ),
        };
      }),
    );
    debounceSegmentPersist(async () => {
      try {
        const updated = await updateReelSegment(projectId, activeReel.id, id, nextPatch);
        replaceReel(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ajuste inválido');
        void reload();
      }
    });
  }

  function handleMoveCaption(id: string, inMs: number, outMs: number) {
    if (!activeReel) return;
    const nextIn = Math.max(0, inMs);
    const nextOut = Math.max(nextIn + 200, outMs);
    setReels((prev) =>
      prev.map((reel) => {
        if (reel.id !== activeReel.id) return reel;
        return {
          ...reel,
          segments: reel.segments.map((segment) =>
            segment.id === id
              ? { ...segment, caption_in_ms: nextIn, caption_out_ms: nextOut }
              : segment,
          ),
        };
      }),
    );
    debounceSegmentPersist(async () => {
      try {
        const updated = await updateReelSegment(projectId, activeReel.id, id, {
          caption_in_ms: nextIn,
          caption_out_ms: nextOut,
        });
        replaceReel(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo mover el subtítulo');
        void reload();
      }
    });
  }

  function handleApplyTransition(segmentId: string, type: TransitionType) {
    const segment = activeReel?.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    void handleSegmentField(segment, { transition_type: type });
  }

  function handleMoveOverlay(id: string, startMs: number) {
    if (!activeReel) return;
    setOverlays((prev) =>
      prev.map((overlay) => (overlay.id === id ? { ...overlay, start_ms: startMs } : overlay)),
    );
    debounceOverlayPersist(async () => {
      try {
        const updated = await updateOverlay(projectId, activeReel.id, id, {
          start_ms: startMs,
        });
        setOverlays((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo mover el overlay');
        void reloadOverlays(activeReel.id);
      }
    });
  }

  async function handleDropAsset(assetId: string, outputSeconds: number) {
    if (!activeReel) return;
    const asset = assets.find((item) => item.id === assetId);
    const isVideo = asset?.kind === 'video';
    setBusy(true);
    setError(null);
    try {
      const created = await createOverlay(projectId, activeReel.id, {
        kind: isVideo ? 'video' : 'image',
        asset_id: assetId,
        start_ms: Math.max(0, Math.round(outputSeconds * 1000)),
        duration_ms: isVideo
          ? Math.max(500, asset?.duration_ms ?? 3000)
          : 3000,
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
    debounceOverlayPersist(async () => {
      try {
        const updated = await updateOverlay(projectId, activeReel.id, overlay.id, patch);
        setOverlays((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo actualizar el overlay');
        void reloadOverlays(activeReel.id);
      }
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
      await flushPendingEditsForExport();
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
    if (jumpingRef.current && !options.force) return;
    const drift = target - music.currentTime;
    const playing = !music.paused && !music.ended;
    const threshold = playing ? 0.45 : 0.2;
    if (options.force || Math.abs(drift) >= threshold) {
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
    if (force) {
      if (musicSyncRafRef.current != null) {
        window.cancelAnimationFrame(musicSyncRafRef.current);
        musicSyncRafRef.current = null;
      }
      pendingMusicOutputRef.current = null;
      void ensureMusicAtOutput(outputSeconds, {
        force: true,
        play: previewingRef.current && !scrubbingRef.current,
      });
      return;
    }
    pendingMusicOutputRef.current = outputSeconds;
    if (musicSyncRafRef.current != null) return;
    musicSyncRafRef.current = window.requestAnimationFrame(() => {
      musicSyncRafRef.current = null;
      const target = pendingMusicOutputRef.current;
      pendingMusicOutputRef.current = null;
      if (target == null) return;
      void ensureMusicAtOutput(target, {
        play: previewingRef.current && !scrubbingRef.current,
      });
    });
  }

  async function playMusicForOutput(outputSeconds: number) {
    await ensureMusicAtOutput(outputSeconds, { force: true, play: true });
  }

  function applyPreviewGain() {
    const video = programVideo();
    const standby = standbyVideo();
    const audio = audioRef.current;
    const separate = usesSeparateAudio();
    const muted = previewMutedRef.current;
    const volume = previewVolumeRef.current;
    if (video) {
      video.muted = separate ? true : muted;
      video.volume = separate ? 1 : muted ? 0 : volume;
    }
    if (standby) {
      standby.muted = true;
      standby.volume = 0;
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
    clearCutTimer();
    if (seekAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(seekAnimationFrameRef.current);
      seekAnimationFrameRef.current = null;
    }
    if (musicSyncRafRef.current != null) {
      window.cancelAnimationFrame(musicSyncRafRef.current);
      musicSyncRafRef.current = null;
    }
    pendingMusicOutputRef.current = null;
    if (audioOffsetSeekTimerRef.current != null) {
      window.clearTimeout(audioOffsetSeekTimerRef.current);
      audioOffsetSeekTimerRef.current = null;
    }
    setPreviewing(false);
    videoARef.current?.pause();
    videoBRef.current?.pause();
    assembledVideoRef.current?.pause();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.playbackRate = 1;
    }
    musicRef.current?.pause();
  }

  function prefetchStandby() {
    const next = orderedSegmentsRef.current[previewIndexRef.current + 1];
    const standby = standbyVideo();
    if (!standby) return;
    standby.muted = true;
    if (!next) {
      standby.pause();
      return;
    }
    if (Math.abs(standby.currentTime - next.source_start_seconds) < 0.08) return;
    setMediaTime(standby, next.source_start_seconds);
  }

  function scheduleCutAdvance() {
    clearCutTimer();
    if (!previewingRef.current || scrubbingRef.current) return;
    const video = programVideo();
    const current = orderedSegmentsRef.current[previewIndexRef.current];
    if (!video || !current) return;
    const remainingMs = (current.source_end_seconds - video.currentTime) * 1000;
    if (remainingMs < 800) prefetchStandby();
    cutTimerRef.current = window.setTimeout(() => {
      cutTimerRef.current = null;
      advanceToNextCut();
    }, Math.max(0, remainingMs - 30));
  }

  function advanceToNextCut() {
    if (jumpingRef.current || !previewingRef.current || scrubbingRef.current) return;
    const ordered = orderedSegmentsRef.current;
    const index = previewIndexRef.current;
    const current = ordered[index];
    const video = programVideo();
    if (!current || !video) {
      stopPreview();
      return;
    }
    if (video.currentTime < current.source_end_seconds - 0.08) {
      scheduleCutAdvance();
      return;
    }
    const next = ordered[index + 1];
    if (!next) {
      stopPreview();
      return;
    }
    previewIndexRef.current = index + 1;
    setPreviewIndex(index + 1);
    if (
      sourceWindowsContiguous(current, next) &&
      Math.abs(video.currentTime - next.source_start_seconds) < 0.2
    ) {
      scheduleCutAdvance();
      prefetchStandby();
      void playMusicForOutput(
        outputTimeForSource(buildOutputClock(ordered), index + 1, next.source_start_seconds),
      );
      return;
    }
    void jumpPreviewToSource(next.source_start_seconds, true, { seekMusic: false });
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
    if (force || Math.abs(drift) >= 0.35) {
      if (!setMediaTime(audio, target)) return;
    }
    pendingAudioTimeRef.current = null;
  }

  async function jumpPreviewToSource(
    sourceTimeSeconds: number,
    resume: boolean,
    options: { seekMusic?: boolean } = {},
  ) {
    const video = programVideo();
    if (!video) return;
    const token = ++jumpTokenRef.current;
    jumpingRef.current = true;
    const audio = audioRef.current;
    const keepPlaying = Boolean(resume && previewingRef.current && !scrubbingRef.current);
    pendingVideoTimeRef.current = sourceTimeSeconds;
    clearCutTimer();

    const finishMusic = async () => {
      if (options.seekMusic === false) return;
      const ordered = orderedSegmentsRef.current;
      const index = previewIndexRef.current;
      const current = ordered[index];
      if (!current) return;
      await playMusicForOutput(
        outputTimeForSource(buildOutputClock(ordered), index, sourceTimeSeconds),
      );
    };

    if (!keepPlaying) {
      video.pause();
      standbyVideo()?.pause();
      if (audio) {
        audio.pause();
        audio.playbackRate = 1;
      }
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
      prefetchStandby();
      return;
    }

    const standby = standbyVideo();
    const standbyReady = Boolean(
      standby &&
        standby.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        Math.abs(standby.currentTime - sourceTimeSeconds) < 0.3,
    );

    if (standbyReady && standby) {
      const outgoing = video;
      const nextLane: 0 | 1 = programLaneRef.current === 0 ? 1 : 0;
      programLaneRef.current = nextLane;
      setProgramLane(nextLane);
      applyPreviewGain();
      try {
        if (standby.paused) await standby.play();
      } catch (err: unknown) {
        if (token !== jumpTokenRef.current) return;
        stopPreview();
        setError(err instanceof Error ? err.message : 'No se pudo reanudar la reproducción');
        return;
      }
      outgoing.pause();
      outgoing.muted = true;
      if (token !== jumpTokenRef.current) return;
      pendingVideoTimeRef.current = null;
      jumpingRef.current = false;
      setSourceTime(sourceTimeSeconds);
      scheduleCutAdvance();
      prefetchStandby();
      await finishMusic();
      return;
    }

    setMediaTime(video, sourceTimeSeconds, true);
    if (usesSeparateAudio() && audio) {
      setMediaTime(audio, audioTimeForVideo(sourceTimeSeconds, audioOffsetRef.current), true);
    }
    pendingVideoTimeRef.current = null;
    jumpingRef.current = false;
    setSourceTime(sourceTimeSeconds);
    applyPreviewGain();
    try {
      if (video.paused) {
        if (usesSeparateAudio() && audio) {
          await Promise.all([video.play(), audio.play()]);
        } else {
          await video.play();
        }
      }
    } catch (err: unknown) {
      if (token !== jumpTokenRef.current) return;
      stopPreview();
      setError(err instanceof Error ? err.message : 'No se pudo reanudar la reproducción');
      return;
    }
    if (token !== jumpTokenRef.current) return;
    scheduleCutAdvance();
    prefetchStandby();
    await finishMusic();
  }

  function applyAudioOffset(offsetMs: number) {
    audioOffsetRef.current = offsetMs;
    setAudioOffsetMs(offsetMs);
    applyPreviewGain();
    if (audioOffsetSeekTimerRef.current != null) return;
    audioOffsetSeekTimerRef.current = window.setTimeout(() => {
      audioOffsetSeekTimerRef.current = null;
      const video = programVideo();
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
    const video = programVideo();
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
    const video = programVideo();
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
    if (!target || !programVideo()) return;
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
    clearCutTimer();
    if (previewMode === 'assembled') {
      assembledVideoRef.current?.pause();
      return;
    }
    videoARef.current?.pause();
    videoBRef.current?.pause();
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
    if (!activeReel || activeReel.segments.length === 0) {
      return;
    }
    const video = programVideo();
    if (!video) return;
    const audio = audioRef.current;
    const total = outputClock.totalDuration;
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
    const videos = [videoARef.current, videoBRef.current].filter(
      (item): item is HTMLVideoElement => Boolean(item),
    );
    const previewAudio = audioRef.current;
    if (videos.length === 0 || !activeReel) return;

    function onTimeUpdate(event: Event) {
      const video = programVideo();
      if (!video || event.target !== video || jumpingRef.current) return;
      setSourceTime(video.currentTime);
      if (scrubbingRef.current) return;
      if (!previewingRef.current || !activeReel) return;
      const ordered = orderedSegmentsRef.current;
      const index = previewIndexRef.current;
      const current = ordered[index];
      if (!current) {
        stopPreview();
        return;
      }
      const outputNow = outputTimeForSource(
        buildOutputClock(ordered),
        index,
        video.currentTime,
      );
      setPreviewOutputTime(Math.max(0, outputNow));
      if (usesSeparateAudio()) syncAudioToVideo(video.currentTime);
      syncMusicToOutput(outputNow);
      if (video.currentTime >= current.source_end_seconds - 0.04) {
        advanceToNextCut();
      } else if (current.source_end_seconds - video.currentTime < 0.8) {
        prefetchStandby();
      }
    }

    function onSeeking(event: Event) {
      const video = programVideo();
      if (!video || event.target !== video) return;
      if (!scrubbingRef.current && !jumpingRef.current && usesSeparateAudio()) {
        syncAudioToVideo(video.currentTime, true);
      }
    }

    function onVideoMetadata(event: Event) {
      if (pendingVideoTimeRef.current == null) return;
      if (!(event.target instanceof HTMLVideoElement)) return;
      if (setMediaTime(event.target, pendingVideoTimeRef.current)) {
        pendingVideoTimeRef.current = null;
      }
    }

    function onAudioMetadata() {
      if (!previewAudio || pendingAudioTimeRef.current == null) return;
      if (setMediaTime(previewAudio, pendingAudioTimeRef.current)) {
        pendingAudioTimeRef.current = null;
      }
    }

    for (const syncedVideo of videos) {
      syncedVideo.addEventListener('timeupdate', onTimeUpdate);
      syncedVideo.addEventListener('seeking', onSeeking);
      syncedVideo.addEventListener('loadedmetadata', onVideoMetadata);
    }
    previewAudio?.addEventListener('loadedmetadata', onAudioMetadata);
    return () => {
      for (const syncedVideo of videos) {
        syncedVideo.removeEventListener('timeupdate', onTimeUpdate);
        syncedVideo.removeEventListener('seeking', onSeeking);
        syncedVideo.removeEventListener('loadedmetadata', onVideoMetadata);
      }
      previewAudio?.removeEventListener('loadedmetadata', onAudioMetadata);
    };
  }, [activeReel, programLane]);

  const orderedSegments = useMemo(
    () => (activeReel ? [...activeReel.segments].sort((a, b) => a.order - b.order) : []),
    [activeReel],
  );
  orderedSegmentsRef.current = orderedSegments;
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
    clearCutTimer();
    programLaneRef.current = 0;
    setProgramLane(0);

    const video = videoARef.current;
    const audio = audioRef.current;
    const first = orderedSegments[0];
    videoBRef.current?.pause();
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
      prefetchStandby();
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
      if (cutTimerRef.current != null) {
        window.clearTimeout(cutTimerRef.current);
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
  const selectedClipIndex = selectedSegment
    ? orderedSegments.findIndex((item) => item.id === selectedSegment.id)
    : -1;
  const selectedClipPlacement =
    selectedClipIndex >= 0 ? outputClock.placements[selectedClipIndex] : undefined;
  const selectedClipCaptionBaseline = selectedSegment
    ? fragmentCaptionBaseline(selectedSegment, timedTranscript)
    : '';
  const selectedClipCaptionDraft = selectedSegment
    ? (transcriptDrafts[selectedSegment.id] ?? selectedClipCaptionBaseline)
    : '';

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
    setSelectedGapKey(null);
    if (track === 'captions') setActiveTool('subtitles');
    else if (track === 'video') setActiveTool('cuts');
  }

  function selectTimelineOverlay(overlayId: string) {
    setSelectedOverlayId(overlayId);
    setSelectedGapKey(null);
    setActiveTool('cuts');
  }

  const selectedGap = selectedGapKey
    ? buildSourceGaps(orderedSegments).find(
        (gap) => `${gap.beforeSegmentId}|${gap.afterSegmentId}` === selectedGapKey,
      ) ?? null
    : null;

  function markInPoint() {
    if (!selectedSegment || sourceTime == null) {
      if (showAddFragment && sourceTime != null) setAddFragmentStart(round3(sourceTime));
      return;
    }
    handleTrimSegment(selectedSegment.id, { source_start_seconds: round3(sourceTime) });
  }

  function markOutPoint() {
    if (!selectedSegment || sourceTime == null) {
      if (showAddFragment && sourceTime != null) setAddFragmentEnd(round3(sourceTime));
      return;
    }
    handleTrimSegment(selectedSegment.id, { source_end_seconds: round3(sourceTime) });
  }

  function nudgePreview(delta: number) {
    seekPreview(Math.max(0, previewOutputTime + delta));
  }

  function seekFromSource(sourceSeconds: number) {
    const mapped = outputTimeAtSource(outputClock, sourceSeconds);
    if (mapped != null) {
      setSelectedGapKey(null);
      seekPreview(mapped);
      return;
    }
    const gap = buildSourceGaps(orderedSegments).find((item) => {
      const previous = orderedSegments.find((seg) => seg.id === item.beforeSegmentId);
      const next = orderedSegments.find((seg) => seg.id === item.afterSegmentId);
      if (!previous || !next) return false;
      return (
        sourceSeconds >= previous.source_end_seconds &&
        sourceSeconds <= next.source_start_seconds
      );
    });
    if (gap) {
      setSelectedGapKey(`${gap.beforeSegmentId}|${gap.afterSegmentId}`);
      setSelectedOverlayId(null);
      setActiveTool('cuts');
    }
  }

  function togglePlayFromTransport() {
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
            err instanceof Error ? err.message : 'El navegador bloqueó la reproducción',
          );
        });
      }
      return;
    }
    if (previewing) stopPreview();
    else startPreview();
  }

  async function restoreOmittedGap(side: 'before' | 'after') {
    if (!activeReel || !selectedGap) return;
    const targetId = side === 'before' ? selectedGap.beforeSegmentId : selectedGap.afterSegmentId;
    const target = orderedSegments.find((item) => item.id === targetId);
    const neighbor =
      side === 'before'
        ? orderedSegments.find((item) => item.id === selectedGap.afterSegmentId)
        : orderedSegments.find((item) => item.id === selectedGap.beforeSegmentId);
    if (!target || !neighbor) return;
    const patch =
      side === 'before'
        ? { source_end_seconds: neighbor.source_start_seconds }
        : { source_start_seconds: neighbor.source_end_seconds };
    handleTrimSegment(target.id, patch);
    setSelectedGapKey(null);
  }

  useEffect(() => {
    if (!activeReel) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.code === 'Space' || key === 'k') {
        event.preventDefault();
        togglePlayFromTransport();
        return;
      }
      if (key === 'j') {
        event.preventDefault();
        nudgePreview(event.shiftKey ? -5 : -1);
        return;
      }
      if (key === 'l') {
        event.preventDefault();
        nudgePreview(event.shiftKey ? 5 : 1);
        return;
      }
      if (key === 'i') {
        event.preventDefault();
        markInPoint();
        return;
      }
      if (key === 'o') {
        event.preventDefault();
        markOutPoint();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
                {REEL_TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  return (
                  <button
                    key={tool.id}
                    id={`reel-tool-tab-${tool.id}`}
                    type="button"
                    role="tab"
                    title={tool.description}
                    aria-selected={activeTool === tool.id}
                    aria-controls={`reel-tool-panel-${tool.id}`}
                    className={`reel-nle__tool${
                      activeTool === tool.id ? ' reel-nle__tool--active' : ''
                    }`}
                    onClick={() => {
                      setActiveTool(tool.id);
                    }}
                  >
                    <Icon size={14} strokeWidth={2} aria-hidden />
                    {tool.label}
                  </button>
                  );
                })}
              </div>
            </nav>
            {error && <p className="error editor-sticky-notice">{error}</p>}
          </div>

          <div className={`reel-nle__main reel-nle__main--${activeTool}`}>
            <div
              className={`reel-nle__workspace${binCollapsed ? ' reel-nle__workspace--bin-collapsed' : ''}${
                inspectorCollapsed ? ' reel-nle__workspace--inspector-collapsed' : ''
              }${layout.inspectorWide && !inspectorCollapsed ? ' reel-nle__workspace--inspector-wide' : ''}`}
              style={{
                ['--nle-bin' as string]: binCollapsed ? 'auto' : `${layout.binPx}px`,
                ['--nle-inspector' as string]: inspectorCollapsed
                  ? '2.15rem'
                  : layout.inspectorWide
                    ? 'minmax(420px, 44%)'
                    : `${layout.inspectorPx}px`,
              }}
            >
              <MediaBinPanel
                projectId={projectId}
                assets={assets}
                onAssetsChange={setAssets}
                onAddTextAtPlayhead={() => void handleAddTextOverlay(previewOutputTime)}
                collapsed={binCollapsed}
                onCollapsedChange={setBinCollapsed}
              />
              <NleSplitter
                label="Ancho del baúl"
                onDrag={(delta) => patchLayout({ binPx: layout.binPx + delta })}
              />
            <div className="reel-nle__stage">
              {hasVideo && orderedSegments.length > 0 ? (
                <div
                  className={`reel-nle__monitors${
                    layout.dualMonitors ? ' reel-nle__monitors--dual' : ''
                  }`}
                >
                  {layout.dualMonitors && (
                    <SourceMonitor
                      projectId={projectId}
                      mediaRevision={mediaRevision}
                      sourceTime={sourceTime}
                      sourceDuration={videoDuration}
                      selectedSegment={selectedSegment}
                      segments={orderedSegments}
                      onSeekSource={seekFromSource}
                    />
                  )}
                <PreviewMonitor
                  projectId={projectId}
                  mediaRevision={mediaRevision}
                  aspectRatio={activeReel.aspect_ratio}
                  videoRef={videoARef}
                  standbyVideoRef={videoBRef}
                  assembledVideoRef={assembledVideoRef}
                  activeProgramLane={programLane}
                  audioRef={audioRef}
                  musicRef={musicRef}
                  assembledSrc={assembledPreviewSrc}
                  previewMode={previewMode}
                  overlays={overlays}
                  outputTime={previewOutputTime}
                  previewing={previewing}
                  musicFilename={backgroundMusic?.music_filename ?? null}
                  musicActive={musicPreviewActive()}
                  selectedOverlayId={selectedOverlayId}
                  framingMode={activeReel.framing_mode}
                  cropX={selectedSegment?.manual_crop_x}
                  cropY={selectedSegment?.manual_crop_y}
                  onSelectOverlay={selectTimelineOverlay}
                  onMoveOverlay={(overlayId, x, y) => {
                    const overlay = overlays.find((item) => item.id === overlayId);
                    if (overlay) void handleOverlayField(overlay, { x, y });
                  }}
                  onAssembledTime={(seconds) => {
                    if (previewMode !== 'assembled' || scrubbingRef.current) return;
                    setPreviewOutputTime(seconds);
                    syncMusicToOutput(seconds);
                  }}
                  separateAudio={Math.abs(audioOffsetMs) >= 1}
                />
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
              {hasVideo && orderedSegments.length > 0 && (
                <PreviewTransport
                  outputTime={previewOutputTime}
                  totalDuration={outputClock.totalDuration}
                  previewing={previewing}
                  previewMuted={previewMuted}
                  assembledBusy={assembledBusy}
                  previewMode={previewMode}
                  voiceVolume={previewVolume}
                  musicVolume={musicVolumeDraft ?? backgroundMusic?.volume ?? 0}
                  musicVolumeSaving={musicVolumeSaving}
                  musicSliderDisabled={
                    !backgroundMusic?.music_filename ||
                    backgroundMusic.preset === 'none' ||
                    !backgroundMusic.enabled
                  }
                  dualMonitors={layout.dualMonitors}
                  onTogglePlay={togglePlayFromTransport}
                  onSeek={seekPreview}
                  onScrubStart={beginPreviewScrub}
                  onScrubEnd={endPreviewScrub}
                  onToggleMute={togglePreviewAudio}
                  onVoiceVolume={changePreviewVolume}
                  onMusicVolume={changeMusicVolume}
                  onMusicVolumeCommit={(value) => {
                    if (musicVolumeSaveTimerRef.current != null) {
                      window.clearTimeout(musicVolumeSaveTimerRef.current);
                      musicVolumeSaveTimerRef.current = null;
                    }
                    void savePreviewMusicVolume(value);
                  }}
                  onPreviewMode={(mode) => void switchPreviewMode(mode)}
                  onDualMonitors={(enabled) => patchLayout({ dualMonitors: enabled })}
                />
              )}
            </div>

            <NleSplitter
              label="Ancho del inspector"
              onDrag={(delta) => patchLayout({ inspectorPx: layout.inspectorPx - delta })}
            />
            <aside className={`reel-nle__inspector reel-nle__inspector--${activeTool}${
              inspectorCollapsed ? ' reel-nle__inspector--collapsed' : ''
            }${layout.inspectorWide ? ' reel-nle__inspector--wide' : ''}`}>
              <button
                type="button"
                className="reel-nle__inspector-toggle"
                aria-expanded={!inspectorCollapsed}
                onClick={() => setInspectorCollapsed((current) => !current)}
              >
                {inspectorCollapsed ? '▸' : '▾'} Inspector
              </button>
              {!inspectorCollapsed && (
                <button
                  type="button"
                  className={`reel-nle__inspector-wide${layout.inspectorWide ? ' reel-nle__inspector-wide--active' : ''}`}
                  title="Ampliar inspector (estilo Resolve)"
                  aria-pressed={layout.inspectorWide}
                  onClick={() => patchLayout({ inspectorWide: !layout.inspectorWide })}
                >
                  {layout.inspectorWide ? '◧ Ancho' : '◨ Ancho'}
                </button>
              )}
              {!inspectorCollapsed && (
              <>
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
                    <AddFragmentForm
                      start={addFragmentStart}
                      end={addFragmentEnd}
                      sourceTime={sourceTime}
                      videoDuration={videoDuration}
                      busy={busy}
                      onStartChange={setAddFragmentStart}
                      onEndChange={setAddFragmentEnd}
                      onUseCurrentStart={() =>
                        sourceTime != null && setAddFragmentStart(round3(sourceTime))
                      }
                      onUseCurrentEnd={() =>
                        sourceTime != null && setAddFragmentEnd(round3(sourceTime))
                      }
                      onAdd={() => void handleAddManualFragment()}
                      onCancel={() => setShowAddFragment(false)}
                    />
                  )}

                  <CutsFilmstrip
                    segments={orderedSegments}
                    selectedId={selectedSegment?.id ?? null}
                    onSelect={(segmentId, index) => {
                      setEditingSegmentId(segmentId);
                      setSelectedOverlayId(null);
                      setSelectedGapKey(null);
                      const placement = outputClock.placements[index];
                      seekPreview(placement?.outputStart ?? 0);
                    }}
                  />

                  {selectedGap && (
                    <OmittedGapInspector
                      gap={selectedGap}
                      onRestoreBefore={() => void restoreOmittedGap('before')}
                      onRestoreAfter={() => void restoreOmittedGap('after')}
                    />
                  )}

                  {selectedSegment && selectedClipIndex >= 0 && (
                    <ClipInspector
                      segment={selectedSegment}
                      index={selectedClipIndex}
                      total={orderedSegments.length}
                      nextSegment={orderedSegments[selectedClipIndex + 1] ?? null}
                      outputStart={selectedClipPlacement?.outputStart ?? 0}
                      outputDuration={
                        selectedClipPlacement?.contentDuration ?? selectedSegment.duration_seconds
                      }
                      captionDraft={selectedClipCaptionDraft}
                      captionBaseline={selectedClipCaptionBaseline}
                      captionSaving={transcriptSavingId === selectedSegment.id}
                      busy={busy}
                      cutSuggestions={cutReport?.suggestions ?? []}
                      cutBusy={cutBusy}
                      onMove={(direction) => void moveSegment(selectedSegment.id, direction)}
                      onRemove={() => void handleRemoveSegment(selectedSegment.id)}
                      onCaptionChange={(value) =>
                        setTranscriptDrafts((current) => ({
                          ...current,
                          [selectedSegment.id]: value,
                        }))
                      }
                      onCaptionCommit={(value) => void saveFragmentCaption(selectedSegment, value)}
                      onSaveCaption={() => void saveFragmentCaption(selectedSegment)}
                      onClearCaption={() => void clearFragmentCaption(selectedSegment)}
                      onOpenSubtitleStyle={() => setActiveTool('subtitles')}
                      onAdjustEdge={(edge, delta) => void adjustEdge(selectedSegment, edge, delta)}
                      onField={(patch) => void handleSegmentField(selectedSegment, patch)}
                      onAcceptCut={(suggestion) => void handleAcceptCut(suggestion)}
                      onRejectCut={(suggestion) => void handleRejectCut(suggestion)}
                    />
                  )}

                  {selectedOverlay && (
                    <OverlayInspector
                      overlay={selectedOverlay}
                      busy={busy}
                      onChange={(patch) => void handleOverlayField(selectedOverlay, patch)}
                      onDelete={() => void handleDeleteOverlay(selectedOverlay.id)}
                    />
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
                  <CoherencePanel
                    projectId={projectId}
                    reelId={activeReel.id}
                    segments={orderedSegments}
                    onReelChange={replaceReel}
                  />
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
                  interactivePreview={activeTool === 'subtitles' && previewMode === 'logical'}
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
                  onBeforeStart={flushPendingEditsForExport}
                  onGoToCuts={() => setActiveTool('cuts')}
                />
              </div>
              </>
              )}
            </aside>
            </div>
            <NleSplitter
              orientation="horizontal"
              label="Alto de la línea temporal"
              onDrag={(delta) => patchLayout({ timelinePx: layout.timelinePx - delta })}
            />
            <div className="reel-nle__timeline-slot" style={{ flexBasis: `${layout.timelinePx}px` }}>
          <ReelTimelineStrip
            segments={orderedSegments}
            overlays={overlays}
            totalDuration={outputClock.totalDuration}
            outputTime={previewOutputTime}
            selectedSegmentId={selectedSegment?.id ?? null}
            selectedOverlayId={selectedOverlayId}
            selectedGapKey={selectedGapKey}
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
            onSelectGap={(key) => {
              setSelectedGapKey(key);
              if (key) {
                setSelectedOverlayId(null);
                setActiveTool('cuts');
              }
            }}
            onSelectOverlay={selectTimelineOverlay}
            onSelectMusic={() => setActiveTool('audio')}
            onReorderSegments={handleReorderSegments}
            onTrimSegment={handleTrimSegment}
            onMoveCaption={handleMoveCaption}
            onApplyTransition={handleApplyTransition}
            onMoveOverlay={handleMoveOverlay}
            onDropAsset={(assetId, outputSeconds) => void handleDropAsset(assetId, outputSeconds)}
            onAddTextOverlay={(outputSeconds) => void handleAddTextOverlay(outputSeconds)}
          />
            </div>
          </div>
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
