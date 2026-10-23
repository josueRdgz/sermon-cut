import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Blend, Captions, Image, Music, Scissors, Square } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { listAnalysisCandidates } from '../api/analysis';
import { ApiError } from '../api/client';
import { listAssets } from '../api/assets';
import {
  createOverlay,
  deleteOverlay,
  listOverlays,
  updateOverlay,
} from '../api/overlays';
import {
  addReelSegment,
  createReel,
  createReelFromTranscript,
  deleteReel,
  listReels,
  removeReelSegment,
  reorderReelSegments,
  joinReelSegment,
  splitReelSegment,
  updateReelSegment,
} from '../api/reels';
import { getTranscript } from '../api/transcripts';
import type { AnalysisCandidate } from '../types/analysis';
import type { ProjectAsset } from '../types/asset';
import type { ReelOverlay } from '../types/overlay';
import type { Project } from '../types/project';
import type { AspectRatio, Reel, ReelSegment, TransitionType } from '../types/reel';
import type { TranscriptSegment } from '../types/transcript';
import { formatDuration, formatTimecode } from '../utils/format';
import { buildOutputClock, outputTimeAtSource, outputTimeForSource, sourceWindowsContiguous } from '../utils/reelOutputClock';
import { previewXfadeStyle, xfadeAudioWeights } from '../utils/previewTransitions';
import { interpolateGain, scaleEnvelopeToGain, type VolumeKeyframe } from '../utils/volumeEnvelope';
import { canJoinSourceWindows, clampRippleTrim, splitTooCloseToEdge } from '../utils/reelTrim';
import { buildSourceGaps } from '../utils/reelTimelineStrip';
import { isNleHotkeyTarget, isReelEditorHotkeysActive } from '../utils/nleHotkeys';
import { isNleCompact, NLE_COMPACT_MQ, TIMELINE_MAX, TIMELINE_MIN } from '../utils/nleLayout';
import { TRANSITION_MIME, TRANSITION_OPTIONS } from './nle/clipConstants';
import { useNleLayout } from '../utils/useNleLayout';
import { TOPBAR_CONTEXT_ID } from './layout/TopBar';
import { AudioRepairPanel } from './AudioRepairPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { CutSuggestionsPanel } from './CutSuggestionsPanel';
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
import { getProjectWaveform } from '../api/projects';
import {
  getBackgroundMusic,
  saveBackgroundMusic,
} from '../api/backgroundMusic';
import type { BackgroundMusicSettings } from '../types/backgroundMusic';
import {
  previewTimelineIdentity,
  playheadAfterTrim,
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
  id: 'cuts' | 'framing' | 'transitions' | 'subtitles' | 'audio' | 'end-card';
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  { id: 'cuts', label: 'Cortes', description: 'Recortar y añadir fragmentos', icon: Scissors },
  { id: 'framing', label: 'Encuadre', description: 'Short o pantalla completa', icon: Square },
  { id: 'transitions', label: 'Transiciones', description: 'Efectos entre clips', icon: Blend },
  { id: 'subtitles', label: 'Subtítulos', description: 'Texto, emojis y estilo', icon: Captions },
  { id: 'audio', label: 'Audio', description: 'Reparar, sincronía y volumen', icon: Music },
  { id: 'end-card', label: 'Pantalla final', description: 'Vista final y exportar', icon: Image },
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
  const [xfadeUi, setXfadeUi] = useState<{ type: TransitionType; outLane: 0 | 1 } | null>(
    null,
  );
  const [activeTool, setActiveTool] = useState<ReelTool>('cuts');
  const [audioOffsetMs, setAudioOffsetMs] = useState(0);
  const [audioOffsetSaving, setAudioOffsetSaving] = useState(false);
  const [sourceTime, setSourceTime] = useState<number | null>(null);
  const [cutReport, setCutReport] = useState<CutSuggestionsReport | null>(null);
  const [cutBusy, setCutBusy] = useState(false);
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({});
  const [, setTranscriptSavingId] = useState<string | null>(null);
  const [showAddFragment, setShowAddFragment] = useState(false);
  const [addFragmentStart, setAddFragmentStart] = useState(0);
  const [addFragmentEnd, setAddFragmentEnd] = useState(5);
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundMusicSettings | null>(null);
  const [musicVolumeSaving, setMusicVolumeSaving] = useState(false);
  const [musicVolumeDraft, setMusicVolumeDraft] = useState<number | null>(null);
  const [videoPeaks, setVideoPeaks] = useState<number[]>([]);
  const [musicPeaks, setMusicPeaks] = useState<number[]>([]);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [overlays, setOverlays] = useState<ReelOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedGapKey, setSelectedGapKey] = useState<string | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(80);
  const [analysisCandidates, setAnalysisCandidates] = useState<AnalysisCandidate[]>([]);
  const [addedCandidateIds, setAddedCandidateIds] = useState<string[]>([]);
  const [binCollapsed, setBinCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null);
  const { layout, patchLayout } = useNleLayout();

  useEffect(() => {
    setChromeSlot(document.getElementById(TOPBAR_CONTEXT_ID));
  }, []);

  function setBinCollapsedExclusive(collapsed: boolean) {
    setBinCollapsed(collapsed);
    if (!collapsed && isNleCompact()) setInspectorCollapsed(true);
  }

  function toggleInspectorExclusive() {
    setInspectorCollapsed((current) => {
      const next = !current;
      if (!next && isNleCompact()) setBinCollapsed(true);
      return next;
    });
  }

  function openInspectorExclusive() {
    setInspectorCollapsed(false);
    if (isNleCompact()) setBinCollapsed(true);
  }
  const nleMainRef = useRef<HTMLDivElement>(null);
  const musicVolumeSaveTimerRef = useRef<number | null>(null);
  const segmentPersistTimerRef = useRef<number | null>(null);
  const overlayPersistTimerRef = useRef<number | null>(null);
  const pendingSegmentWorkRef = useRef<(() => Promise<void>) | null>(null);
  const pendingOverlayWorkRef = useRef<(() => Promise<void>) | null>(null);
  const assembledVideoRef = useRef<HTMLVideoElement>(null);
  const reloadEpochRef = useRef(0);
  const previewIndexRef = useRef(0);
  const previewingRef = useRef(false);
  const previewOutputTimeRef = useRef(0);
  const clipEnvelopeRef = useRef<{ keys?: VolumeKeyframe[]; outputStart: number }>({
    outputStart: 0,
  });
  const lastPreviewReelIdRef = useRef<string | null>(null);
  const focusedReelRef = useRef<string | null>(null);
  const audioOffsetRef = useRef(0);
  const audioOffsetMsRef = useRef(0);
  const editingSegmentIdRef = useRef<string | null>(null);
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
  const previewRafRef = useRef<number | null>(null);
  const xfadeRef = useRef<{
    type: TransitionType;
    outLane: 0 | 1;
    fromIndex: number;
    toIndex: number;
    duration: number;
  } | null>(null);

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
    function collapseIfBothOpen() {
      if (isNleCompact() && !binCollapsed && !inspectorCollapsed) {
        setInspectorCollapsed(true);
      }
    }
    collapseIfBothOpen();
    const mq = window.matchMedia(NLE_COMPACT_MQ);
    mq.addEventListener('change', collapseIfBothOpen);
    return () => mq.removeEventListener('change', collapseIfBothOpen);
  }, [binCollapsed, inspectorCollapsed]);

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
    const segments = activeReel?.segments ?? [];
    const selected =
      segments.find((item) => item.id === editingSegmentId) ??
      [...segments].sort((a, b) => a.order - b.order)[0];
    const savedOffset = selected?.audio_offset_ms ?? 0;
    audioOffsetRef.current = savedOffset;
    setAudioOffsetMs(savedOffset);
  }, [activeReel?.id, editingSegmentId]); // eslint-disable-line react-hooks/exhaustive-deps -- initialize on switch

  useEffect(() => {
    if (!activeReel || !editingSegmentId) return;
    const segment = activeReel.segments.find((item) => item.id === editingSegmentId);
    if (!segment || audioOffsetMs === (segment.audio_offset_ms ?? 0)) return;
    const reelId = activeReel.id;
    const segmentId = editingSegmentId;
    const offset = audioOffsetMs;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAudioOffsetSaving(true);
      updateReelSegment(projectId, reelId, segmentId, { audio_offset_ms: offset })
        .then((updated) => {
          if (cancelled) return;
          replaceReel(updated);
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
  }, [activeReel, audioOffsetMs, editingSegmentId, projectId]);

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

  async function handleAddAnalysisCandidate(candidate: AnalysisCandidate) {
    setBusy(true);
    setError(null);
    try {
      let reel = activeReel;
      if (!reel) {
        reel = await createReel(projectId, {
          title: candidate.title || titleDraft.trim() || 'Nuevo Reel',
          aspect_ratio: aspect,
          segments: [],
        });
      }
      let updated = reel;
      for (const fragment of candidate.segments) {
        updated = await addReelSegment(projectId, updated.id, {
          source_start_seconds: fragment.start,
          source_end_seconds: fragment.end,
          transcript_text: fragment.exact_text || null,
          transition_type: 'hard_cut',
          transition_duration_ms: 0,
        });
      }
      replaceReel(updated);
      setAddedCandidateIds((current) =>
        current.includes(candidate.id) ? current : [...current, candidate.id],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo añadir el corte al Reel');
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

  function toggleAddFragmentForm() {
    if (showAddFragment) {
      setShowAddFragment(false);
      return;
    }
    openAddFragmentForm();
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

  function adjustEdge(segment: ReelSegment, edge: 'start' | 'end', delta: number) {
    const start =
      edge === 'start'
        ? round3(segment.source_start_seconds + delta)
        : segment.source_start_seconds;
    const end =
      edge === 'end' ? round3(segment.source_end_seconds + delta) : segment.source_end_seconds;
    handleTrimSegment(segment.id, {
      source_start_seconds: start,
      source_end_seconds: end,
    });
  }

  function handleSegmentField(
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
    if (patch.source_start_seconds != null || patch.source_end_seconds != null) {
      handleTrimSegment(segment.id, {
        source_start_seconds: patch.source_start_seconds,
        source_end_seconds: patch.source_end_seconds,
      });
      if (
        patch.transition_type == null &&
        patch.transition_duration_ms == null &&
        patch.transcript_text == null
      ) {
        return;
      }
    }
    const payload = { ...patch };
    if (patch.transition_type && patch.transition_type !== 'hard_cut') {
      const currentMs = patch.transition_duration_ms ?? segment.transition_duration_ms ?? 0;
      if (patch.transition_duration_ms === undefined && currentMs <= 0) {
        payload.transition_duration_ms = 350;
      }
    } else if (patch.transition_type === 'hard_cut') {
      payload.transition_duration_ms = 0;
    }
    setReels((prev) =>
      prev.map((reel) => {
        if (reel.id !== activeReel.id) return reel;
        return {
          ...reel,
          segments: reel.segments.map((item) =>
            item.id === segment.id ? { ...item, ...payload } : item,
          ),
        };
      }),
    );
    debounceSegmentPersist(async () => {
      try {
        const updated = await updateReelSegment(projectId, activeReel.id, segment.id, payload);
        replaceReel(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo actualizar el fragmento');
        void reload();
      }
    });
  }

  async function handleRemoveSegment(segmentId: string) {
    await handleRemoveSegments([segmentId]);
  }

  async function handleRemoveSegments(segmentIds: string[]) {
    if (!activeReel || segmentIds.length === 0) return;
    const unique = [...new Set(segmentIds)];
    setBusy(true);
    try {
      let updated = activeReel;
      for (const id of unique) {
        updated = await removeReelSegment(projectId, updated.id, id);
      }
      replaceReel(updated);
      if (editingSegmentId && unique.includes(editingSegmentId)) setEditingSegmentId(null);
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
    const selectedForExport = activeReel?.segments.find((item) => item.id === editingSegmentId);
    if (
      activeReel &&
      selectedForExport &&
      audioOffsetMs !== (selectedForExport.audio_offset_ms ?? 0)
    ) {
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

  function handleMoveCaption(id: string, inMs: number, outMs: number, persist = true) {
    handleMoveCaptions([{ id, inMs, outMs }], persist);
  }

  function handleMoveCaptions(
    items: { id: string; inMs: number; outMs: number }[],
    persist = true,
  ) {
    if (!activeReel || items.length === 0) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    setReels((prev) =>
      prev.map((reel) => {
        if (reel.id !== activeReel.id) return reel;
        return {
          ...reel,
          segments: reel.segments.map((segment) => {
            const next = byId.get(segment.id);
            if (!next) return segment;
            const nextIn = Math.max(0, next.inMs);
            return {
              ...segment,
              caption_in_ms: nextIn,
              caption_out_ms: Math.max(nextIn + 200, next.outMs),
            };
          }),
        };
      }),
    );
    if (!persist) return;
    debounceSegmentPersist(async () => {
      try {
        let updated = activeReel;
        for (const item of items) {
          const nextIn = Math.max(0, item.inMs);
          updated = await updateReelSegment(projectId, activeReel.id, item.id, {
            caption_in_ms: nextIn,
            caption_out_ms: Math.max(nextIn + 200, item.outMs),
          });
        }
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
    handleMoveOverlays([{ id, startMs, lane: overlays.find((item) => item.id === id)?.z_index ?? 0 }]);
  }

  function handleMoveOverlays(
    items: { id: string; startMs: number; lane: number }[],
    persist = true,
  ) {
    if (!activeReel || items.length === 0) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    setOverlays((prev) =>
      prev.map((overlay) => {
        const next = byId.get(overlay.id);
        if (!next) return overlay;
        return { ...overlay, start_ms: next.startMs, z_index: next.lane };
      }),
    );
    if (!persist) return;
    debounceOverlayPersist(async () => {
      try {
        for (const item of items) {
          const updated = await updateOverlay(projectId, activeReel.id, item.id, {
            start_ms: item.startMs,
            z_index: item.lane,
          });
          setOverlays((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo mover el overlay');
        void reloadOverlays(activeReel.id);
      }
    });
  }

  async function handleDropAsset(assetId: string, outputSeconds: number, lane = 0) {
    if (!activeReel) return;
    const asset = assets.find((item) => item.id === assetId);
    const kind =
      asset?.kind === 'audio' ? 'audio' : asset?.kind === 'video' ? 'video' : 'image';
    setBusy(true);
    setError(null);
    try {
      const created = await createOverlay(projectId, activeReel.id, {
        kind,
        asset_id: assetId,
        start_ms: Math.max(0, Math.round(outputSeconds * 1000)),
        duration_ms:
          kind === 'image'
            ? 3000
            : Math.max(500, Math.min(600_000, asset?.duration_ms ?? 3000)),
        z_index: Math.max(0, lane),
      });
      setOverlays((prev) => [...prev, created].sort((a, b) => a.start_ms - b.start_ms));
      setSelectedOverlayId(created.id);
      openInspectorExclusive();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo colocar el archivo en la línea de tiempo');
    } finally {
      setBusy(false);
    }
  }

  async function splitAtPlayhead(atOutput?: number) {
    if (!activeReel) return;
    const output = atOutput ?? previewOutputTimeRef.current;
    const target = resolvePreviewSeek(orderedSegmentsRef.current, output);
    if (!target) {
      setError('Coloca el cursor sobre un clip para partirlo.');
      return;
    }
    const segment = orderedSegmentsRef.current[target.segmentIndex];
    if (!segment) {
      setError('Coloca el cursor sobre un clip para partirlo.');
      return;
    }
    if (
      splitTooCloseToEdge(segment.source_start_seconds, target.sourceTime, segment.source_end_seconds)
    ) {
      setError('Demasiado cerca del borde; mueve al menos 0,2 s hacia el centro del clip.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await splitReelSegment(
        projectId,
        activeReel.id,
        segment.id,
        round3(target.sourceTime),
      );
      replaceReel(updated);
      seekPreview(output);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'split_out_of_range') {
        setError('Demasiado cerca del borde; mueve al menos 0,2 s hacia el centro del clip.');
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo partir el clip');
      }
    } finally {
      setBusy(false);
    }
  }

  async function joinAtCut(segmentId: string) {
    if (!activeReel) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await joinReelSegment(projectId, activeReel.id, segmentId);
      replaceReel(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo unir el corte');
    } finally {
      setBusy(false);
    }
  }

  function handleVolumeKeyframes(segmentId: string, points: VolumeKeyframe[]) {
    if (!activeReel) return;
    setReels((prev) =>
      prev.map((reel) =>
        reel.id === activeReel.id
          ? {
              ...reel,
              segments: reel.segments.map((segment) =>
                segment.id === segmentId ? { ...segment, volume_keyframes: points } : segment,
              ),
            }
          : reel,
      ),
    );
    debounceSegmentPersist(async () => {
      try {
        const updated = await updateReelSegment(projectId, activeReel.id, segmentId, {
          volume_keyframes: points,
        });
        replaceReel(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el volumen');
      }
    });
  }

  function handleMusicVolumeKeyframes(points: VolumeKeyframe[]) {
    if (!backgroundMusic) return;
    const next = { ...backgroundMusic, volume_keyframes: points };
    setBackgroundMusic(next);
    debounceSegmentPersist(async () => {
      try {
        setBackgroundMusic(await saveBackgroundMusic(projectId, { volume_keyframes: points }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el volumen de la música');
      }
    });
  }

  async function handleAddTextOverlay(outputSeconds: number, lane = 0) {
    if (!activeReel) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createOverlay(projectId, activeReel.id, {
        kind: 'text',
        text: 'Texto',
        start_ms: Math.max(0, Math.round(outputSeconds * 1000)),
        duration_ms: 3000,
        z_index: Math.max(0, lane),
      });
      setOverlays((prev) => [...prev, created].sort((a, b) => a.start_ms - b.start_ms));
      setSelectedOverlayId(created.id);
      openInspectorExclusive();
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
      z_index?: number;
    },
  ) {
    if (!activeReel) return;
    const nextPatch = {
      ...patch,
      ...(patch.scale != null
        ? { scale: Math.max(0.08, Math.min(2, patch.scale)) }
        : {}),
    };
    setOverlays((prev) =>
      prev.map((item) => (item.id === overlay.id ? { ...item, ...nextPatch } : item)),
    );
    debounceOverlayPersist(async () => {
      try {
        const updated = await updateOverlay(projectId, activeReel.id, overlay.id, nextPatch);
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

  function syncPlayingAudioOffset() {
    const playing = orderedSegmentsRef.current[previewIndexRef.current];
    if (!playing) return;
    audioOffsetRef.current =
      playing.id === editingSegmentIdRef.current
        ? audioOffsetMsRef.current
        : (playing.audio_offset_ms ?? 0);
  }

  function usesSeparateAudio(): boolean {
    // Offset needs a second clock. Otherwise keep A/V locked in one element so
    // hard cuts do not desync or leave silence while the second element seeks.
    syncPlayingAudioOffset();
    return Math.abs(audioOffsetRef.current) >= 1;
  }

  function separateAudioReady(): boolean {
    const audio = audioRef.current;
    return Boolean(
      usesSeparateAudio() &&
        audio &&
        !audio.error &&
        audio.readyState >= HTMLMediaElement.HAVE_METADATA,
    );
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
    const envelope = interpolateGain(settings?.volume_keyframes, previewOutputTime * 1000);
    const bed = musicPreviewActive(settings)
      ? Math.max(0, Math.min(1, (settings?.volume ?? 0) * envelope))
      : 0;
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

  function clampMediaVolume(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  function clipGainAt(index: number, outputTime: number, ordered: ReelSegment[]): number {
    const segment = ordered[index];
    const placement = buildOutputClock(ordered).placements[index];
    if (!segment || !placement) return 1;
    const localMs = Math.max(0, (outputTime - placement.outputStart) * 1000);
    return interpolateGain(segment.volume_keyframes, localMs);
  }

  function xfadeProgress(sourceTime: number, ordered: ReelSegment[]): number {
    const xfade = xfadeRef.current;
    const current = ordered[xfade?.fromIndex ?? previewIndexRef.current];
    if (!xfade || !current || xfade.duration <= 0) return 0;
    const remaining = current.source_end_seconds - sourceTime;
    return Math.max(0, Math.min(1, 1 - remaining / xfade.duration));
  }

  function applyXfadeVars(type: TransitionType | string, progress: number) {
    const stage = videoARef.current?.parentElement ?? videoBRef.current?.parentElement;
    if (!stage) return;
    const style = previewXfadeStyle(type, progress);
    stage.style.setProperty('--xfade-out', String(style.outOpacity));
    stage.style.setProperty('--xfade-in', String(style.inOpacity));
    stage.style.setProperty('--xfade-veil', String(style.veilOpacity));
    stage.style.setProperty('--xfade-veil-color', style.veilColor);
    stage.style.setProperty('--xfade-clip', style.inClipPath);
    stage.style.setProperty('--xfade-move', style.inTransform);
  }

  function clearXfadeVars() {
    const stage = videoARef.current?.parentElement ?? videoBRef.current?.parentElement;
    if (!stage) return;
    for (const name of [
      '--xfade-out',
      '--xfade-in',
      '--xfade-veil',
      '--xfade-veil-color',
      '--xfade-clip',
      '--xfade-move',
    ]) {
      stage.style.removeProperty(name);
    }
  }

  function cancelXfade() {
    if (!xfadeRef.current) return;
    xfadeRef.current = null;
    setXfadeUi(null);
    clearXfadeVars();
  }

  function applyPreviewGain() {
    const ordered = orderedSegmentsRef.current;
    const index = previewIndexRef.current;
    const video = programVideo();
    const standby = standbyVideo();
    const audio = audioRef.current;
    const xfade = xfadeRef.current;
    const sourceTime = video?.currentTime ?? 0;
    const outputTime = outputTimeForSource(buildOutputClock(ordered), index, sourceTime);
    previewOutputTimeRef.current = outputTime;
    const muted = previewMutedRef.current;
    const volume = previewVolumeRef.current;
    const progress = xfade ? xfadeProgress(sourceTime, ordered) : 0;
    const mix = xfade ? xfadeAudioWeights(progress) : { out: 1, in: 0 };
    const outGain = clipGainAt(index, outputTime, ordered);
    const inGain = xfade ? clipGainAt(xfade.toIndex, outputTime, ordered) : 1;
    const outVol = muted ? 0 : volume * outGain * mix.out;
    const inVol = xfade && !muted ? volume * inGain * mix.in : 0;
    const separate = separateAudioReady() && !xfade;
    if (xfade) applyXfadeVars(xfade.type, progress);
    if (video) {
      video.muted = separate ? true : muted || outVol <= 0.0005;
      video.volume = separate ? 1 : clampMediaVolume(outVol);
    }
    if (standby) {
      standby.muted = Boolean(separate || muted || inVol <= 0.0005);
      standby.volume = separate ? 0 : clampMediaVolume(inVol);
    }
    if (audio) {
      audio.muted = separate ? muted : true;
      audio.volume = separate ? (muted ? 0 : clampMediaVolume(volume * outGain)) : 0;
      if (!separate && !xfade) {
        audio.pause();
        audio.playbackRate = 1;
      }
    }
    applyMusicGain();
  }

  function stopPreviewTick() {
    if (previewRafRef.current != null) {
      window.cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
  }

  function ensurePreviewTick() {
    if (previewRafRef.current != null) return;
    const tick = () => {
      previewRafRef.current = window.requestAnimationFrame(tick);
      runPreviewTick();
    };
    previewRafRef.current = window.requestAnimationFrame(tick);
  }

  function startIncomingClip(next: ReelSegment) {
    const standby = standbyVideo();
    if (!standby) return;
    if (Math.abs(standby.currentTime - next.source_start_seconds) > 0.35) {
      setMediaTime(standby, next.source_start_seconds);
    }
    void standby.play().catch(() => undefined);
  }

  function completeXfade() {
    const xfade = xfadeRef.current;
    if (!xfade) return;
    const outgoing = xfade.outLane === 0 ? videoARef.current : videoBRef.current;
    outgoing?.pause();
    if (outgoing) {
      outgoing.muted = true;
      outgoing.volume = 0;
    }
    const nextLane: 0 | 1 = xfade.outLane === 0 ? 1 : 0;
    programLaneRef.current = nextLane;
    setProgramLane(nextLane);
    previewIndexRef.current = xfade.toIndex;
    setPreviewIndex(xfade.toIndex);
    xfadeRef.current = null;
    setXfadeUi(null);
    clearXfadeVars();
    const incoming = nextLane === 0 ? videoARef.current : videoBRef.current;
    if (incoming) {
      syncPlayingAudioOffset();
      if (separateAudioReady()) {
        const audio = audioRef.current;
        if (audio) {
          setMediaTime(
            audio,
            audioTimeForVideo(incoming.currentTime, audioOffsetRef.current),
            true,
          );
          void audio.play().catch(() => undefined);
        }
      }
    }
    applyPreviewGain();
    scheduleCutAdvance();
    prefetchStandby();
  }

  function runPreviewTick() {
    if (!previewingRef.current || jumpingRef.current || scrubbingRef.current) {
      applyPreviewGain();
      return;
    }
    const video = programVideo();
    const ordered = orderedSegmentsRef.current;
    const index = previewIndexRef.current;
    const current = ordered[index];
    if (!video || !current) return;
    applyPreviewGain();
    const next = ordered[index + 1];
    const overlap = buildOutputClock(ordered).placements[index]?.overlapSeconds ?? 0;
    const remaining = current.source_end_seconds - video.currentTime;
    if (overlap > 0 && next && remaining <= overlap + 0.02) {
      if (!xfadeRef.current) {
        const outLane = programLaneRef.current;
        const type = current.transition_type;
        xfadeRef.current = {
          type,
          outLane,
          fromIndex: index,
          toIndex: index + 1,
          duration: overlap,
        };
        setXfadeUi({ type, outLane });
        startIncomingClip(next);
      }
      if (remaining <= 0.04) completeXfade();
      return;
    }
    if (xfadeRef.current && remaining > overlap + 0.08) {
      cancelXfade();
      standbyVideo()?.pause();
      applyPreviewGain();
    }
  }

  function stopPreview() {
    previewingRef.current = false;
    scrubbingRef.current = false;
    resumeAfterScrubRef.current = false;
    jumpingRef.current = false;
    pendingPreviewSeekRef.current = null;
    stopPreviewTick();
    cancelXfade();
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
    if (xfadeRef.current) return;
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
    const overlapMs =
      (buildOutputClock(orderedSegmentsRef.current).placements[previewIndexRef.current]
        ?.overlapSeconds ?? 0) * 1000;
    if (remainingMs < Math.max(800, overlapMs + 250)) prefetchStandby();
    cutTimerRef.current = window.setTimeout(() => {
      cutTimerRef.current = null;
      advanceToNextCut();
    }, Math.max(0, remainingMs - 30));
  }

  function advanceToNextCut() {
    if (jumpingRef.current || !previewingRef.current || scrubbingRef.current) return;
    if (xfadeRef.current) {
      completeXfade();
      return;
    }
    const ordered = orderedSegmentsRef.current;
    const index = previewIndexRef.current;
    const current = ordered[index];
    const video = programVideo();
    if (!current || !video) {
      stopPreview();
      return;
    }
    const overlap =
      buildOutputClock(ordered).placements[index]?.overlapSeconds ?? 0;
    const remaining = current.source_end_seconds - video.currentTime;
    if (overlap > 0 && remaining <= overlap + 0.08) {
      runPreviewTick();
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
    if (!separateAudioReady()) return;
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
    cancelXfade();
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
      if (separateAudioReady() && audio) {
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
      ensurePreviewTick();
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
    if (separateAudioReady() && audio) {
      setMediaTime(audio, audioTimeForVideo(sourceTimeSeconds, audioOffsetRef.current), true);
    }
    pendingVideoTimeRef.current = null;
    jumpingRef.current = false;
    setSourceTime(sourceTimeSeconds);
    applyPreviewGain();
    try {
      if (video.paused) {
        if (separateAudioReady() && audio) {
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
    ensurePreviewTick();
    await finishMusic();
  }

  function applyAudioOffset(offsetMs: number) {
    setAudioOffsetMs(offsetMs);
    audioOffsetMsRef.current = offsetMs;
    const playing = orderedSegmentsRef.current[previewIndexRef.current];
    if (!playing || playing.id === editingSegmentIdRef.current) {
      audioOffsetRef.current = offsetMs;
    }
    applyPreviewGain();
    if (!playing || playing.id !== editingSegmentIdRef.current) return;
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
    if (!activeReel || !editingSegmentIdRef.current) return;
    setAudioOffsetSaving(true);
    setError(null);
    try {
      const updated = await updateReelSegment(
        projectId,
        activeReel.id,
        editingSegmentIdRef.current,
        { audio_offset_ms: offsetMs },
      );
      replaceReel(updated);
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
    const target = resolvePreviewSeek(orderedSegments, outputSeconds);
    if (!target || !programVideo()) return;
    previewIndexRef.current = target.segmentIndex;
    setPreviewIndex(target.segmentIndex);
    setPreviewOutputTime(target.outputTime);
    setSourceTime(target.sourceTime);
    pendingPreviewSeekRef.current = target;
    cancelXfade();
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
    cancelXfade();
    clearCutTimer();
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
    ensurePreviewTick();
    const waitForMetadata = (media: HTMLMediaElement) => {
      if (media.error) {
        return Promise.reject(new Error('No se pudo cargar el medio para el preview'));
      }
      if (media.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
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
    };
    const mediaReady =
      usesSeparateAudio() && audio && !audio.error
        ? Promise.all([waitForMetadata(video), waitForMetadata(audio)])
        : waitForMetadata(video);
    void mediaReady
      .then(async () => {
        if (!previewingRef.current || scrubbingRef.current) return;
        await jumpPreviewToSource(target.sourceTime, true);
      })
      .catch(async (err: unknown) => {
        if (previewingRef.current && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
          await jumpPreviewToSource(target.sourceTime, true);
          return;
        }
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
    setPreviewMuted(nextMuted);
    previewMutedRef.current = nextMuted;
    previewVolumeRef.current = 1;
    setPreviewVolume(1);
    const ordered = orderedSegmentsRef.current;
    const index = previewIndexRef.current;
    const segment = ordered[index] ?? ordered[0];
    if (segment) {
      const clock = buildOutputClock(ordered);
      const placement = clock.placements[index] ?? clock.placements[0];
      const localMs = Math.max(
        0,
        (previewOutputTimeRef.current - (placement?.outputStart ?? 0)) * 1000,
      );
      handleVolumeKeyframes(segment.id, scaleEnvelopeToGain(segment.volume_keyframes, localMs, nextVolume));
    }
    applyPreviewGain();
  }

  function changeMusicVolume(value: number) {
    const clamped = Math.max(0, Math.min(value, 1));
    if (previewMutedRef.current && clamped > 0) {
      setPreviewMuted(false);
      previewMutedRef.current = false;
    }
    const output = previewOutputTimeRef.current;
    const overlay =
      overlays.find((item) => item.id === selectedOverlayId && item.kind === 'audio') ??
      overlays.find((item) => {
        if (item.kind !== 'audio') return false;
        const start = item.start_ms / 1000;
        return output >= start && output < start + Math.max(0.2, item.duration_ms / 1000);
      }) ??
      null;
    if (overlay) {
      setMusicVolumeDraft(clamped);
      void handleOverlayField(overlay, { opacity: clamped });
      return;
    }
    if (!backgroundMusic) return;
    const tMs = previewOutputTimeRef.current * 1000;
    const keys = scaleEnvelopeToGain(backgroundMusic.volume_keyframes, tMs, clamped);
    const next = { ...backgroundMusic, volume: 1, volume_keyframes: keys };
    setBackgroundMusic(next);
    setMusicVolumeDraft(clamped);
    applyMusicGain(next);
    if (musicVolumeSaveTimerRef.current != null) {
      window.clearTimeout(musicVolumeSaveTimerRef.current);
    }
    musicVolumeSaveTimerRef.current = window.setTimeout(() => {
      musicVolumeSaveTimerRef.current = null;
      void savePreviewMusicVolume(clamped, keys);
    }, 350);
  }

  async function savePreviewMusicVolume(volume: number, keyframes?: VolumeKeyframe[]) {
    const clamped = Math.max(0, Math.min(volume, 1));
    setMusicVolumeSaving(true);
    try {
      const next = await saveBackgroundMusic(projectId, {
        volume: 1,
        volume_keyframes: keyframes ?? scaleEnvelopeToGain(
          backgroundMusic?.volume_keyframes,
          previewOutputTimeRef.current * 1000,
          clamped,
        ),
      });
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
  }, [backgroundMusic, previewOutputTime]);

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
    let cancelled = false;
    getProjectWaveform(projectId, 'video')
      .then((data) => {
        if (!cancelled) setVideoPeaks(data.peaks);
      })
      .catch(() => {
        if (!cancelled) setVideoPeaks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!backgroundMusic?.music_filename) {
      setMusicPeaks([]);
      return;
    }
    let cancelled = false;
    getProjectWaveform(projectId, 'music')
      .then((data) => {
        if (!cancelled) setMusicPeaks(data.peaks);
      })
      .catch(() => {
        if (!cancelled) setMusicPeaks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, backgroundMusic?.music_filename]);

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
      applyPreviewGain();
      if (!xfadeRef.current && usesSeparateAudio()) syncAudioToVideo(video.currentTime);
      syncMusicToOutput(outputNow);
      if (xfadeRef.current) {
        if (video.currentTime >= current.source_end_seconds - 0.04) completeXfade();
      } else if (video.currentTime >= current.source_end_seconds - 0.04) {
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
  editingSegmentIdRef.current = editingSegmentId;
  audioOffsetMsRef.current = audioOffsetMs;
  const outputClock = useMemo(() => buildOutputClock(orderedSegments), [orderedSegments]);
  const selectedOverlay =
    overlays.find((item) => item.id === selectedOverlayId) ?? null;
  const audioOverlay =
    selectedOverlay?.kind === 'audio'
      ? selectedOverlay
      : overlays.find((item) => {
          if (item.kind !== 'audio') return false;
          const start = item.start_ms / 1000;
          return (
            previewOutputTime >= start &&
            previewOutputTime < start + Math.max(0.2, item.duration_ms / 1000)
          );
        }) ?? null;
  const previewIdentity = previewTimelineIdentity(activeReel?.id, orderedSegments);

  useEffect(() => {
    previewOutputTimeRef.current = previewOutputTime;
  }, [previewOutputTime]);

  useEffect(() => {
    const first = orderedSegments[0];
    const reelId = activeReel?.id ?? null;
    const reelChanged = lastPreviewReelIdRef.current !== reelId;
    lastPreviewReelIdRef.current = reelId;

    const pauseProgram = () => {
      previewingRef.current = false;
      setPreviewing(false);
      clearCutTimer();
      programLaneRef.current = 0;
      setProgramLane(0);
      videoARef.current?.pause();
      videoBRef.current?.pause();
      audioRef.current?.pause();
    };

    const showSourceFrame = (sourceSeconds: number) => {
      const video = programVideo() ?? videoARef.current;
      const audio = audioRef.current;
      if (!video) return;
      const apply = () => {
        setMediaTime(video, sourceSeconds);
        applyPreviewGain();
        if (usesSeparateAudio() && audio) {
          syncAudioToVideo(sourceSeconds, true);
        }
        setSourceTime(sourceSeconds);
        prefetchStandby();
      };
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        apply();
      } else {
        video.addEventListener('loadedmetadata', apply, { once: true });
      }
    };

    if (!first) {
      pauseProgram();
      previewIndexRef.current = 0;
      setPreviewIndex(0);
      setPreviewOutputTime(0);
      setSourceTime(null);
      return;
    }

    if (reelChanged) {
      pauseProgram();
      previewIndexRef.current = 0;
      setPreviewIndex(0);
      setPreviewOutputTime(0);
      showSourceFrame(first.source_start_seconds);
      return;
    }

    const video = programVideo();
    const liveSource =
      video && video.readyState >= HTMLMediaElement.HAVE_METADATA
        ? video.currentTime
        : (sourceTime ?? first.source_start_seconds);
    const next = playheadAfterTrim(orderedSegments, previewIndexRef.current, liveSource);
    if (!next) return;
    previewIndexRef.current = next.segmentIndex;
    setPreviewIndex(next.segmentIndex);
    setPreviewOutputTime(next.outputTime);
    previewOutputTimeRef.current = next.outputTime;
    setSourceTime(next.sourceTime);
    if (next.seekRequired) {
      if (previewingRef.current && !scrubbingRef.current) {
        void jumpPreviewToSource(next.sourceTime, true);
      } else {
        showSourceFrame(next.sourceTime);
      }
    } else if (previewingRef.current) {
      scheduleCutAdvance();
    }
  }, [previewIdentity]); // eslint-disable-line react-hooks/exhaustive-deps -- keep playhead on trim; only reset when the Reel changes

  useEffect(() => {
    void listAssets(projectId)
      .then((response) => setAssets(response.items))
      .catch(() => setAssets([]));
  }, [projectId]);

  useEffect(() => {
    void listAnalysisCandidates(projectId)
      .then((response) => setAnalysisCandidates(response.items))
      .catch(() => setAnalysisCandidates([]));
  }, [projectId, refreshToken]);

  useEffect(() => {
    if (!activeReel?.id) {
      setOverlays([]);
      setSelectedOverlayId(null);
      return;
    }
    void reloadOverlays(activeReel.id);
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
  const playingSegment = orderedSegments[previewIndex] ?? selectedSegment;
  const playingPlacement = outputClock.placements[previewIndex] ?? selectedClipPlacement;
  const previewAudioOffsetMs =
    playingSegment?.id === selectedSegment?.id
      ? audioOffsetMs
      : (playingSegment?.audio_offset_ms ?? 0);
  clipEnvelopeRef.current = {
    keys: playingSegment?.volume_keyframes,
    outputStart: playingPlacement?.outputStart ?? 0,
  };
  const voiceHeard = previewMuted
    ? 0
    : interpolateGain(
        playingSegment?.volume_keyframes,
        Math.max(0, (previewOutputTime - (playingPlacement?.outputStart ?? 0)) * 1000),
      );
  const musicHeard = previewMuted
    ? 0
    : audioOverlay
      ? audioOverlay.opacity
      : (backgroundMusic?.volume ?? 0) *
        interpolateGain(backgroundMusic?.volume_keyframes, previewOutputTime * 1000);

  const captionLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const segment of orderedSegments) {
      labels[segment.id] =
        transcriptDrafts[segment.id] ?? fragmentCaptionBaseline(segment, timedTranscript);
    }
    return labels;
  }, [orderedSegments, timedTranscript, transcriptDrafts]);

  function selectTimelineSegment(segmentId: string, _track: TimelineTrackKind) {
    setEditingSegmentId(segmentId);
    setSelectedOverlayId(null);
    setSelectedGapKey(null);
  }

  function selectTimelineOverlay(overlayId: string) {
    setSelectedOverlayId(overlayId);
    setSelectedGapKey(null);
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
    }
  }

  function togglePlayFromTransport() {
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
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!isReelEditorHotkeysActive() || !isNleHotkeyTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.repeat && (key === 'c' || key === 'u' || key === 'i' || key === 'o')) return;
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
        return;
      }
      if (key === 'c') {
        event.preventDefault();
        void splitAtPlayhead();
        return;
      }
      if (key === 'u') {
        event.preventDefault();
        const ordered = orderedSegmentsRef.current;
        const output = previewOutputTimeRef.current;
        const clock = buildOutputClock(ordered);
        let joinId: string | null = null;
        for (let index = 0; index < ordered.length - 1; index += 1) {
          const placement = clock.placements[index];
          const next = clock.placements[index + 1];
          if (!placement || !next) continue;
          const visualEnd = placement.outputStart + placement.contentDuration;
          if (
            Math.abs(output - next.outputStart) <= 0.75 ||
            Math.abs(output - visualEnd) <= 0.75
          ) {
            if (
              canJoinSourceWindows(
                ordered[index].source_end_seconds,
                ordered[index + 1].source_start_seconds,
              )
            ) {
              joinId = ordered[index].id;
              break;
            }
          }
        }
        if (joinId) void joinAtCut(joinId);
        else setError('Unir (U) solo funciona en el corte que partiste tú. Coloca el cursor en esa unión.');
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
          {(() => {
            const reelBar = (
              <div className={`reel-nle__reel-bar${chromeSlot ? ' reel-nle__reel-bar--chrome' : ''}`}>
                <div className="reel-nle__reel-title">
                  <strong>
                    {reels.findIndex((reel) => reel.id === activeReel.id) + 1}. {activeReel.title}
                  </strong>
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
            );
            return chromeSlot ? createPortal(reelBar, chromeSlot) : reelBar;
          })()}
          <div className="reel-nle__top">
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
                      openInspectorExclusive();
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

          <div ref={nleMainRef} className={`reel-nle__main reel-nle__main--${activeTool}`}>
            <div
              className={`reel-nle__workspace${binCollapsed ? ' reel-nle__workspace--bin-collapsed' : ''}${
                inspectorCollapsed ? ' reel-nle__workspace--inspector-collapsed' : ''
              }${layout.inspectorWide && !inspectorCollapsed ? ' reel-nle__workspace--inspector-wide' : ''}`}
              style={{
                ['--nle-bin' as string]: binCollapsed ? '2.4rem' : `${layout.binPx}px`,
                ['--nle-inspector' as string]: inspectorCollapsed
                  ? '2.4rem'
                  : layout.inspectorWide
                    ? `${Math.min(layout.inspectorPx + 60, 420)}px`
                    : `${layout.inspectorPx}px`,
              }}
            >
              <MediaBinPanel
                projectId={projectId}
                assets={assets}
                onAssetsChange={setAssets}
                onAddTextAtPlayhead={() => void handleAddTextOverlay(previewOutputTime)}
                onAddAtPlayhead={(assetId) => void handleDropAsset(assetId, previewOutputTime)}
                collapsed={binCollapsed}
                onCollapsedChange={setBinCollapsedExclusive}
                analysisCandidates={analysisCandidates.map((candidate) =>
                  addedCandidateIds.includes(candidate.id)
                    ? { ...candidate, status: 'accepted' }
                    : candidate,
                )}
                onAddCandidate={(candidate) => void handleAddAnalysisCandidate(candidate)}
                candidatesBusy={busy}
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
                  assembledSrc={null}
                  previewMode="logical"
                  overlays={overlays}
                  outputTime={previewOutputTime}
                  previewing={previewing}
                  previewMuted={previewMuted}
                  musicFilename={backgroundMusic?.music_filename ?? null}
                  musicActive={musicPreviewActive()}
                  selectedOverlayId={selectedOverlayId}
                  framingMode={activeReel.framing_mode}
                  cropX={playingSegment?.manual_crop_x}
                  cropY={playingSegment?.manual_crop_y}
                  onSelectOverlay={selectTimelineOverlay}
                  onMoveOverlay={(overlayId, x, y) => {
                    const overlay = overlays.find((item) => item.id === overlayId);
                    if (overlay) void handleOverlayField(overlay, { x, y });
                  }}
                  onScaleOverlay={(overlayId, scale) => {
                    const overlay = overlays.find((item) => item.id === overlayId);
                    if (overlay) void handleOverlayField(overlay, { scale });
                  }}
                  onAssembledTime={() => undefined}
                  separateAudio={Math.abs(previewAudioOffsetMs) >= 1}
                  xfade={xfadeUi}
                  incomingCropX={
                    xfadeUi
                      ? orderedSegments[previewIndex + 1]?.manual_crop_x
                      : null
                  }
                  incomingCropY={
                    xfadeUi
                      ? orderedSegments[previewIndex + 1]?.manual_crop_y
                      : null
                  }
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
                  voiceVolume={voiceHeard}
                  musicVolume={
                    musicVolumeDraft ??
                    (audioOverlay ? audioOverlay.opacity : musicHeard)
                  }
                  musicVolumeSaving={musicVolumeSaving}
                  musicSliderDisabled={!audioOverlay && !backgroundMusic?.music_filename}
                  dualMonitors={layout.dualMonitors}
                  onTogglePlay={togglePlayFromTransport}
                  onSeek={seekPreview}
                  onScrubStart={beginPreviewScrub}
                  onScrubEnd={endPreviewScrub}
                  onToggleMute={togglePreviewAudio}
                  onVoiceVolume={changePreviewVolume}
                  onMusicVolume={changeMusicVolume}
                  onMusicVolumeCommit={(value) => {
                    if (audioOverlay) {
                      void handleOverlayField(audioOverlay, { opacity: value });
                      setMusicVolumeDraft(null);
                      return;
                    }
                    if (musicVolumeSaveTimerRef.current != null) {
                      window.clearTimeout(musicVolumeSaveTimerRef.current);
                      musicVolumeSaveTimerRef.current = null;
                    }
                    void savePreviewMusicVolume(value);
                  }}
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
                aria-label={inspectorCollapsed ? 'Mostrar ajustes' : 'Ocultar ajustes'}
                onClick={toggleInspectorExclusive}
              >
                {inspectorCollapsed ? '▸' : '▾'} Ajustes
              </button>
              {!inspectorCollapsed && (
                <button
                  type="button"
                  className={`reel-nle__inspector-wide${layout.inspectorWide ? ' reel-nle__inspector-wide--active' : ''}`}
                  title="Ampliar panel de ajustes"
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
                    <h3 className="reel-nle__cuts-title">Ajuste de cortes</h3>
                    <div className="button-stack">
                      <button
                        type="button"
                        className="button button--secondary"
                        aria-pressed={showAddFragment}
                        onClick={() => toggleAddFragmentForm()}
                        disabled={busy}
                      >
                        {showAddFragment ? 'Ocultar fragmento' : 'Añadir fragmento'}
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
                      busy={busy}
                      cutSuggestions={cutReport?.suggestions ?? []}
                      cutBusy={cutBusy}
                      onMove={(direction) => void moveSegment(selectedSegment.id, direction)}
                      onRemove={() => void handleRemoveSegment(selectedSegment.id)}
                      onAdjustEdge={(edge, delta) => void adjustEdge(selectedSegment, edge, delta)}
                      onField={(patch) => void handleSegmentField(selectedSegment, patch)}
                      onAcceptCut={(suggestion) => void handleAcceptCut(suggestion)}
                      onRejectCut={(suggestion) => void handleRejectCut(suggestion)}
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
                  active={activeTool === 'framing'}
                />
              </div>

              <div
                id="reel-tool-panel-transitions"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-transitions"
                hidden={activeTool !== 'transitions'}
              >
                <div className="reel-editor__section-header">
                  <h4>Transiciones</h4>
                </div>
                <p className="muted">
                  Arrastra un efecto y suéltalo en el diamante entre dos clips.
                </p>
                <div className="reel-nle__fx-tray reel-nle__fx-tray--panel" aria-label="Transiciones">
                  {TRANSITION_OPTIONS.filter((option) => option.value !== 'hard_cut').map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="reel-nle__fx-chip"
                      draggable
                      title={`Arrastra «${option.label}» entre dos clips`}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy';
                        event.dataTransfer.setData(TRANSITION_MIME, option.value);
                        event.dataTransfer.setData('text/plain', option.value);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
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
                  mountPreviewOverlay={activeTool === 'subtitles'}
                  interactivePreview={activeTool === 'subtitles'}
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
                      Sincronía voz de este corte:{' '}
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
                          audioOffsetSaving ||
                          !selectedSegment ||
                          audioOffsetMs === (selectedSegment.audio_offset_ms ?? 0)
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
                      <button
                        type="button"
                        className="button button--inline"
                        disabled={
                          audioOffsetSaving ||
                          selectedClipIndex <= 0 ||
                          !orderedSegments[selectedClipIndex - 1]
                        }
                        onClick={() => {
                          const previous = orderedSegments[selectedClipIndex - 1];
                          if (!previous) return;
                          const copied = previous.audio_offset_ms ?? 0;
                          applyAudioOffset(copied);
                          void saveAudioOffset(copied);
                        }}
                      >
                        Como el anterior
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
                    disabled={!selectedSegment}
                    onChange={(event) => applyAudioOffset(Number(event.target.value))}
                    onPointerUp={commitAudioOffsetPreview}
                    onPointerCancel={commitAudioOffsetPreview}
                    onKeyUp={commitAudioOffsetPreview}
                    onBlur={commitAudioOffsetPreview}
                  />
                  <p className="muted">
                    Aplica solo al corte seleccionado. «Como el anterior» copia la sincronía del
                    corte previo. La música importada en Archivos no se desplaza.
                  </p>
                </div>
                <details className="reel-nle__details" open>
                  <summary>Analizar y reparar audio</summary>
                  <AudioRepairPanel projectId={projectId} hasVideo={hasVideo} />
                </details>
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
              {(selectedOverlay ||
                (selectedSegment && activeTool !== 'cuts' && activeTool !== 'transitions')) && (
                <div className="reel-nle__selection-dock">
                  {selectedOverlay ? (
                    <OverlayInspector
                      overlay={selectedOverlay}
                      busy={busy}
                      compact
                      onChange={(patch) => void handleOverlayField(selectedOverlay, patch)}
                      onDelete={() => void handleDeleteOverlay(selectedOverlay.id)}
                    />
                  ) : selectedSegment && selectedClipIndex >= 0 ? (
                    <ClipInspector
                      compact
                      segment={selectedSegment}
                      index={selectedClipIndex}
                      total={orderedSegments.length}
                      nextSegment={orderedSegments[selectedClipIndex + 1] ?? null}
                      outputStart={selectedClipPlacement?.outputStart ?? 0}
                      outputDuration={
                        selectedClipPlacement?.contentDuration ?? selectedSegment.duration_seconds
                      }
                      busy={busy}
                      cutSuggestions={[]}
                      cutBusy={false}
                      onMove={(direction) => void moveSegment(selectedSegment.id, direction)}
                      onRemove={() => void handleRemoveSegment(selectedSegment.id)}
                      onAdjustEdge={(edge, delta) => void adjustEdge(selectedSegment, edge, delta)}
                      onField={(patch) => void handleSegmentField(selectedSegment, patch)}
                      onAcceptCut={() => undefined}
                      onRejectCut={() => undefined}
                    />
                  ) : null}
                </div>
              )}
              </>
              )}
            </aside>
            </div>
            <NleSplitter
              orientation="horizontal"
              label="Alto de la línea temporal"
              onDrag={(delta) => {
                const mainH = nleMainRef.current?.clientHeight ?? 720;
                const max = Math.max(TIMELINE_MIN, Math.min(TIMELINE_MAX, mainH - 180));
                patchLayout({
                  timelinePx: Math.min(max, Math.max(TIMELINE_MIN, layout.timelinePx - delta)),
                });
              }}
            />
            <div
              className="reel-nle__timeline-slot"
              style={{ flexBasis: `${layout.timelinePx}px`, height: `${layout.timelinePx}px` }}
            >
          <ReelTimelineStrip
            reelId={activeReel.id}
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
              }
            }}
            onSelectOverlay={selectTimelineOverlay}
            onSelectMusic={() => setActiveTool('audio')}
            onReorderSegments={handleReorderSegments}
            onTrimSegment={handleTrimSegment}
            onMoveCaption={handleMoveCaption}
            onMoveCaptions={handleMoveCaptions}
            onApplyTransition={handleApplyTransition}
            onMoveOverlay={handleMoveOverlay}
            onMoveOverlays={handleMoveOverlays}
            onDropAsset={(assetId, outputSeconds, lane) =>
              void handleDropAsset(assetId, outputSeconds, lane)
            }
            onAddTextOverlay={(outputSeconds, lane) => void handleAddTextOverlay(outputSeconds, lane)}
            onSplitAtPlayhead={(output) => void splitAtPlayhead(output)}
            onJoinAtCut={(segmentId) => void joinAtCut(segmentId)}
            onDeleteOverlay={(overlayId) => void handleDeleteOverlay(overlayId)}
            onDeleteSegments={(ids) => void handleRemoveSegments(ids)}
            onMoveOverlayLane={(overlayId, lane) => {
              const overlay = overlays.find((item) => item.id === overlayId);
              if (!overlay) return;
              void handleOverlayField(overlay, { z_index: lane });
            }}
            videoPeaks={videoPeaks}
            musicPeaks={musicPeaks}
            sourceDuration={videoDuration ?? 0}
            onVolumeKeyframes={handleVolumeKeyframes}
            onMusicVolumeKeyframes={handleMusicVolumeKeyframes}
            musicKeyframes={backgroundMusic?.volume_keyframes}
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
