import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Blend, Captions, FolderOpen, Image, MonitorPlay, Music, Scissors, Square, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { acceptAnalysisCandidate, listAnalysisCandidates } from '../api/analysis';
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
import { clampOverlayScale, type ReelOverlay } from '../types/overlay';
import { mergeTextOverlayStyle } from '../utils/textOverlayStyle';
import type { Project } from '../types/project';
import type { AspectRatio, Reel, ReelSegment, TransitionType } from '../types/reel';
import type { TranscriptSegment } from '../types/transcript';
import { formatDuration, formatTimecode } from '../utils/format';
import {
  buildOutputClock,
  DEFAULT_TRANSITION_MS,
  editTimeFromOutput,
  outputTimeAtSource,
  outputTimeForSource,
  outputTimeFromEdit,
  sourceWindowsContiguous,
} from '../utils/reelOutputClock';
import { previewXfadeStyle, xfadeAudioWeights } from '../utils/previewTransitions';
import { interpolateGain, type VolumeKeyframe } from '../utils/volumeEnvelope';
import {
  canJoinSourceWindows,
  clampRippleTrim,
  clipDeleteAction,
  joinPartnerId,
  splitTooCloseToEdge,
} from '../utils/reelTrim';
import { collectLaneOccupants, occupantId, placeOnLane, placeTextOverlay } from '../utils/laneOccupancy';
import { captionIsOmitted, captionWindowForPlacement } from '../utils/reelCaptions';
import { laneForCaption, laneForSegment, loadLaneLayout } from '../utils/nleLanes';
import { buildClipSpans, buildSourceGaps } from '../utils/reelTimelineStrip';
import { isNleHotkeyTarget, isReelEditorHotkeysActive } from '../utils/nleHotkeys';
import {
  maxInspectorForWorkspace,
  measureTimelineContentPx,
  TIMELINE_MAX,
  TIMELINE_MIN,
} from '../utils/nleLayout';
import {
  clampTransitionMs,
  formatTransitionSeconds,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  TRANSITION_DURATION_MIME,
  TRANSITION_DURATION_PRESETS_MS,
  TRANSITION_MIME,
  TRAY_TRANSITION_OPTIONS,
} from './nle/clipConstants';
import { ReelPicker } from './nle/ReelPicker';
import { TransitionGlyph } from './nle/TransitionGlyph';
import { useNleLayout } from '../utils/useNleLayout';
import { TOPBAR_CONTEXT_ID } from './layout/TopBar';
import { AudioRepairPanel } from './AudioRepairPanel';
import { CutSuggestionsPanel } from './CutSuggestionsPanel';
import { EndCardPanel } from './EndCardPanel';
import { FramingPanel } from './FramingPanel';
import {
  addableAnalysisCandidates,
  addedCandidateIdsOnReel,
  AnalysisProposalList,
  originWindowsForReel,
  visibleAnalysisCandidates,
} from './AnalysisProposalList';
import { MediaBinPanel } from './MediaBinPanel';
import { AddFragmentForm } from './nle/AddFragmentForm';
import { ClipInspector } from './nle/ClipInspector';
import { CutsFilmstrip } from './nle/CutsFilmstrip';
import { NleSplitter } from './nle/NleSplitter';
import { OmittedGapInspector } from './nle/OmittedGapInspector';
import { OverlayInspector } from './nle/OverlayInspector';
import { TextOverlayPanel } from './TextOverlayPanel';
import { PreviewMonitor } from './nle/PreviewMonitor';
import { PreviewTransport } from './nle/PreviewTransport';
import { SourceMonitor } from './nle/SourceMonitor';
import { AudioExportPanel } from './AudioExportPanel';
import { RenderPanel } from './RenderPanel';
import { CoherencePanel } from './CoherencePanel';
import { ReelTimelineStrip, type TimelineTrackKind } from './ReelTimelineStrip';
import { SubtitlePanel } from './SubtitlePanel';
import type { CutSuggestion, CutSuggestionsReport } from '../types/cutSuggestions';
import { acceptCutSuggestion, rejectCutSuggestion } from '../api/cutSuggestions';
import { getProjectWaveform, projectAudioUrl } from '../api/projects';
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
  active?: boolean;
  focusReelId?: string | null;
  onCoverUpdated?: (project: Project) => void;
}

const ASPECT_OPTIONS: AspectRatio[] = ['9:16', '1:1', '16:9'];
const REEL_TOOLS: {
  id: 'files' | 'cuts' | 'text' | 'framing' | 'transitions' | 'subtitles' | 'audio' | 'end-card';
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  { id: 'files', label: 'Archivos', description: 'Medios y propuestas del análisis', icon: FolderOpen },
  { id: 'cuts', label: 'Cortes', description: 'Recortar y añadir fragmentos', icon: Scissors },
  { id: 'text', label: 'Texto', description: 'Recuadros, tipografía y estilo', icon: Type },
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
  active = true,
  focusReelId = null,
  onCoverUpdated,
}: ReelEditorProps) {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const programLaneRef = useRef<0 | 1>(0);
  const [programLane, setProgramLane] = useState<0 | 1>(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const [audioSrc, setAudioSrc] = useState(() => projectAudioUrl(projectId, mediaRevision));
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
  const [previewing, setPreviewing] = useState(false);
  const [previewInPad, setPreviewInPad] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewOutputTime, setPreviewOutputTime] = useState(0);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [previewVolume, setPreviewVolume] = useState(1);
  const [xfadeUi, setXfadeUi] = useState<{ type: TransitionType; outLane: 0 | 1 } | null>(
    null,
  );
  const [activeTool, setActiveTool] = useState<ReelTool>('cuts');
  const [trayTransitionMs, setTrayTransitionMs] = useState(DEFAULT_TRANSITION_MS);
  const [audioOffsetMs, setAudioOffsetMs] = useState(0);
  const [audioOffsetSaving, setAudioOffsetSaving] = useState(false);
  const [normalizeLoudness, setNormalizeLoudness] = useState(true);
  const [sourceTime, setSourceTime] = useState<number | null>(null);
  const [cutReport, setCutReport] = useState<CutSuggestionsReport | null>(null);
  const [cutBusy, setCutBusy] = useState(false);
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({});
  const [, setTranscriptSavingId] = useState<string | null>(null);
  const [showAddFragment, setShowAddFragment] = useState(false);
  const [addFragmentStart, setAddFragmentStart] = useState(0);
  const [addFragmentEnd, setAddFragmentEnd] = useState(5);
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundMusicSettings | null>(null);
  const [videoPeaks, setVideoPeaks] = useState<number[]>([]);
  const [musicPeaks, setMusicPeaks] = useState<number[]>([]);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [overlays, setOverlays] = useState<ReelOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedGapKey, setSelectedGapKey] = useState<string | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(80);
  const [analysisCandidates, setAnalysisCandidates] = useState<AnalysisCandidate[]>([]);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null);
  const { layout, patchLayout } = useNleLayout();
  const nleMainRef = useRef<HTMLDivElement>(null);
  const timelineSlotRef = useRef<HTMLDivElement>(null);
  const [timelineContentMax, setTimelineContentMax] = useState(TIMELINE_MAX);

  useEffect(() => {
    setChromeSlot(document.getElementById(TOPBAR_CONTEXT_ID));
  }, []);

  useEffect(() => {
    const workspace = nleMainRef.current?.querySelector('.reel-nle__workspace');
    if (!(workspace instanceof HTMLElement) || layout.previewCollapsed) return undefined;
    const apply = () => {
      const max = maxInspectorForWorkspace(workspace.clientWidth);
      if (layout.inspectorPx > max) patchLayout({ inspectorPx: max });
    };
    const observer = new ResizeObserver(apply);
    observer.observe(workspace);
    apply();
    return () => observer.disconnect();
  }, [layout.inspectorPx, layout.previewCollapsed, inspectorCollapsed, patchLayout]);

  useLayoutEffect(() => {
    const slot = timelineSlotRef.current;
    if (!slot) return undefined;
    const observed = new Set<Element>();
    const apply = () => {
      const content = measureTimelineContentPx(slot);
      setTimelineContentMax(content);
      if (layout.timelinePx > content) patchLayout({ timelinePx: content });
    };
    const resizeObserver = new ResizeObserver(apply);
    const attach = () => {
      [
        slot,
        slot.querySelector('.reel-nle__strip'),
        slot.querySelector('.reel-nle__strip-chrome'),
        slot.querySelector('.reel-nle__board'),
        slot.querySelector('.reel-nle__tracks'),
        slot.querySelector('.reel-nle__label-col'),
      ].forEach((node) => {
        if (node && !observed.has(node)) {
          observed.add(node);
          resizeObserver.observe(node);
        }
      });
      apply();
    };
    const mutationObserver = new MutationObserver(attach);
    mutationObserver.observe(slot, { childList: true, subtree: true });
    attach();
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [layout.timelinePx, patchLayout]);

  function openInspectorExclusive() {
    setInspectorCollapsed(false);
  }
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
  const omittedCaptionIdsRef = useRef(new Set<string>());
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
  const lastHeardVolumeRef = useRef(1);
  const previewRafRef = useRef<number | null>(null);
  const inPadRef = useRef(false);
  const padWallRef = useRef(0);
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

  function programAudio(): HTMLAudioElement | null {
    return audioRef.current;
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

  async function handleEditAnalysisCandidate(candidate: AnalysisCandidate) {
    setBusy(true);
    setError(null);
    try {
      if (candidate.accepted_reel_id) {
        const existing = reels.find((reel) => reel.id === candidate.accepted_reel_id);
        if (existing) {
          stopPreview();
          setEditingSegmentId(null);
          setActiveReelId(existing.id);
          setAspect(existing.aspect_ratio);
          return;
        }
      }
      const result = await acceptAnalysisCandidate(projectId, candidate.id, aspect);
      const [reelList, listed] = await Promise.all([
        listReels(projectId),
        listAnalysisCandidates(projectId),
      ]);
      setReels(reelList.items);
      setAnalysisCandidates(listed.items);
      stopPreview();
      setEditingSegmentId(null);
      setActiveReelId(result.reel_id);
      const created = reelList.items.find((item) => item.id === result.reel_id);
      if (created) setAspect(created.aspect_ratio);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la propuesta en el editor');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddAnalysisCandidate(candidate: AnalysisCandidate) {
    if (!activeReel) {
      await handleEditAnalysisCandidate(candidate);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let updated = activeReel;
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
        payload.transition_duration_ms = DEFAULT_TRANSITION_MS;
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
    await handleDeleteCuts([segmentId]);
  }

  async function handleDeleteCuts(segmentIds: string[]) {
    if (!activeReel || segmentIds.length === 0) return;
    const unique = [...new Set(segmentIds)];
    const originWindows = originWindowsForReel(analysisCandidates, activeReel.id);
    if (
      unique.every((id) => clipDeleteAction(activeReel.segments, id, originWindows) === 'keep')
    ) {
      setError('El video del fragmento elegido no se puede eliminar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let updated = activeReel;
      for (const id of unique) {
        const action = clipDeleteAction(updated.segments, id, originWindows);
        if (action === 'join') {
          const partner = joinPartnerId(updated.segments, id);
          if (partner) updated = await joinReelSegment(projectId, updated.id, partner);
        } else if (action === 'remove' && updated.segments.some((segment) => segment.id === id)) {
          updated = await removeReelSegment(projectId, updated.id, id);
        }
      }
      replaceReel(updated);
      if (editingSegmentId && unique.includes(editingSegmentId)) setEditingSegmentId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCaptions(ids: string[]) {
    if (!activeReel || ids.length === 0) return;
    const unique = [...new Set(ids)];
    unique.forEach((id) => omittedCaptionIdsRef.current.add(id));
    setReels((prev) =>
      prev.map((reel) => {
        if (reel.id !== activeReel.id) return reel;
        return {
          ...reel,
          segments: reel.segments.map((segment) =>
            unique.includes(segment.id)
              ? { ...segment, caption_in_ms: 0, caption_out_ms: 0 }
              : segment,
          ),
        };
      }),
    );
    setError(null);
    try {
      let updated = activeReel;
      for (const id of unique) {
        updated = await updateReelSegment(projectId, activeReel.id, id, {
          caption_in_ms: 0,
          caption_out_ms: 0,
        });
      }
      replaceReel(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el subtítulo');
      void reload();
    }
  }

  function handleRestoreCaptions(ids: string[]) {
    if (!activeReel || ids.length === 0) return;
    const unique = [...new Set(ids)];
    unique.forEach((id) => omittedCaptionIdsRef.current.delete(id));
    const clock = buildOutputClock(activeReel.segments);
    const items = unique.flatMap((id) => {
      const segment = activeReel.segments.find((item) => item.id === id);
      if (!segment) return [];
      const placement = clock.placements.find((item) => item.id === id);
      const start = placement?.outputStart ?? 0;
      const duration = placement?.contentDuration ?? segment.duration_seconds;
      const window = captionWindowForPlacement(start, duration);
      return [{ id, inMs: window.caption_in_ms, outMs: window.caption_out_ms }];
    });
    if (items.length === 0) return;
    handleMoveCaptions(items, true);
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

  function handleMoveVideoPad(id: string, padBeforeMs: number, persist = true) {
    if (!activeReel) return;
    const nextPad = Math.max(0, Math.min(120_000, Math.round(padBeforeMs)));
    setReels((prev) =>
      prev.map((reel) => {
        if (reel.id !== activeReel.id) return reel;
        return {
          ...reel,
          segments: reel.segments.map((segment) =>
            segment.id === id ? { ...segment, pad_before_ms: nextPad } : segment,
          ),
        };
      }),
    );
    if (!persist) return;
    debounceSegmentPersist(async () => {
      try {
        const updated = await updateReelSegment(projectId, activeReel.id, id, {
          pad_before_ms: nextPad,
        });
        replaceReel(updated);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'request_cancelled') return;
        setError(err instanceof Error ? err.message : 'No se pudo mover el video');
        void reload();
      }
    });
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
    items = items.filter((item) => !omittedCaptionIdsRef.current.has(item.id));
    if (items.length === 0) return;
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
        if (err instanceof ApiError && err.code === 'request_cancelled') return;
        setError(err instanceof Error ? err.message : 'No se pudo mover el subtítulo');
        void reload();
      }
    });
  }

  const captionSeedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeReel) return;
    const missing = activeReel.segments.filter(
      (segment) => segment.caption_in_ms == null || segment.caption_out_ms == null,
    );
    if (missing.length === 0) {
      captionSeedKeyRef.current = activeReel.id;
      return;
    }
    const seedKey = `${activeReel.id}:${missing.map((segment) => segment.id).join(',')}`;
    if (captionSeedKeyRef.current === seedKey) return;
    captionSeedKeyRef.current = seedKey;
    const clock = buildOutputClock(activeReel.segments);
    handleMoveCaptions(
      missing.map((segment) => {
        const placement = clock.placements.find((item) => item.id === segment.id);
        const start = placement?.outputStart ?? 0;
        const duration = placement?.contentDuration ?? segment.duration_seconds;
        return {
          id: segment.id,
          inMs: Math.round(start * 1000),
          outMs: Math.round((start + duration) * 1000),
        };
      }),
      true,
    );
  }, [activeReel]);

  function handleApplyTransition(segmentId: string, type: TransitionType, durationMs?: number) {
    const segment = activeReel?.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    if (type === 'hard_cut') {
      void handleSegmentField(segment, { transition_type: type, transition_duration_ms: 0 });
      return;
    }
    const nextMs = clampTransitionMs(durationMs ?? trayTransitionMs);
    setTrayTransitionMs(nextMs);
    void handleSegmentField(segment, {
      transition_type: type,
      transition_duration_ms: nextMs,
    });
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

  function snapOverlayToLane(
    startSec: number,
    durationSec: number,
    lane: number,
    options?: { asText?: boolean },
  ) {
    if (!activeReel) return { startSec: Math.max(0, startSec), lane: Math.max(0, lane) };
    const layout = loadLaneLayout(activeReel.id);
    const clips = [...activeReel.segments].sort((a, b) => a.order - b.order);
    const spans = buildClipSpans(clips);
    const targetLane = Math.max(0, lane);
    const laneCount = Math.max(layout.laneCount, targetLane + 1);
    const clock = buildOutputClock(clips);
    const programEnd = spans.reduce((max, span) => Math.max(max, span.start + span.duration), 0);
    const byLane = collectLaneOccupants({
      laneCount,
      clips: spans.map((span) => ({
        id: span.id,
        lane: laneForSegment(layout, span.id),
        start: span.start,
        end: span.start + span.duration,
      })),
      captions: activeReel.subtitle_enabled
        ? clips.flatMap((segment, index) => {
            if (captionIsOmitted(segment)) return [];
            const span = spans[index];
            const start =
              segment.caption_in_ms != null
                ? editTimeFromOutput(clock, segment.caption_in_ms / 1000)
                : span?.start ?? 0;
            const end =
              segment.caption_out_ms != null
                ? editTimeFromOutput(clock, segment.caption_out_ms / 1000)
                : (span?.start ?? 0) + (span?.duration ?? 0);
            return [
              {
                id: segment.id,
                lane: laneForCaption(layout, segment.id),
                start,
                end,
              },
            ];
          })
        : [],
      overlays: overlays.map((overlay) => {
        const start = editTimeFromOutput(clock, overlay.start_ms / 1000);
        const end = editTimeFromOutput(
          clock,
          overlay.start_ms / 1000 + Math.max(0.2, overlay.duration_ms / 1000),
        );
        return {
          id: overlay.id,
          lane: overlay.z_index,
          start,
          end: Math.max(start + 0.2, end),
          asText: overlay.kind === 'text',
        };
      }),
      musicLane:
        backgroundMusic?.enabled &&
        backgroundMusic.music_filename &&
        backgroundMusic.scope === 'full_reel' &&
        backgroundMusic.preset !== 'none'
          ? layout.musicLane
          : null,
      musicEnd: programEnd,
    });
    const duration = Math.max(0.2, durationSec);
    const editStart = editTimeFromOutput(clock, Math.max(0, startSec));
    const candidate = {
      id: occupantId(options?.asText ? 'text' : 'overlay', '__new__'),
      kind: (options?.asText ? 'text' : 'overlay') as 'text' | 'overlay',
      start: editStart,
      end: editStart + duration,
    };
    if (options?.asText) {
      const packed = placeTextOverlay(byLane, candidate, laneCount, targetLane);
      return { startSec: outputTimeFromEdit(clock, packed.occupant.start), lane: packed.lane };
    }
    const placed = placeOnLane(byLane.get(targetLane) ?? [], candidate);
    return { startSec: outputTimeFromEdit(clock, placed.start), lane: targetLane };
  }

  async function handleDropAsset(assetId: string, outputSeconds: number, lane = 0) {
    if (!activeReel) return;
    const asset = assets.find((item) => item.id === assetId);
    const kind =
      asset?.kind === 'audio' ? 'audio' : asset?.kind === 'video' ? 'video' : 'image';
    const durationMs =
      kind === 'image'
        ? 3000
        : Math.max(500, Math.min(600_000, asset?.duration_ms ?? 3000));
    const snapped = snapOverlayToLane(outputSeconds, durationMs / 1000, lane);
    setBusy(true);
    setError(null);
    try {
      const created = await createOverlay(projectId, activeReel.id, {
        kind,
        asset_id: assetId,
        start_ms: Math.max(0, Math.round(snapped.startSec * 1000)),
        duration_ms: durationMs,
        z_index: snapped.lane,
      });
      setOverlays((prev) => [...prev, created].sort((a, b) => a.start_ms - b.start_ms));
      setSelectedOverlayId(created.id);
      if (kind === 'image') setActiveTool('files');
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
    if (!target || target.inPad) {
      setError('Coloca el cursor sobre un clip para cortarlo.');
      return;
    }
    const segment = orderedSegmentsRef.current[target.segmentIndex];
    if (!segment) {
      setError('Coloca el cursor sobre un clip para cortarlo.');
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
        setError(err instanceof Error ? err.message : 'No se pudo cortar el clip');
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
    const snapped = snapOverlayToLane(outputSeconds, 3, lane, { asText: true });
    setBusy(true);
    setError(null);
    try {
      const created = await createOverlay(projectId, activeReel.id, {
        kind: 'text',
        text: 'Texto',
        style_json: JSON.stringify({
          font_family: 'Helvetica Neue',
          font_size: 52,
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
        }),
        start_ms: Math.max(0, Math.round(snapped.startSec * 1000)),
        duration_ms: 3000,
        z_index: snapped.lane,
      });
      setOverlays((prev) => [...prev, created].sort((a, b) => a.start_ms - b.start_ms));
      setSelectedOverlayId(created.id);
      setActiveTool('text');
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
      style_json?: string | null;
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
      ...(patch.scale != null ? { scale: clampOverlayScale(patch.scale) } : {}),
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
    // Offset needs a second clock. Otherwise the video's own soundtrack plays.
    syncPlayingAudioOffset();
    return Math.abs(audioOffsetRef.current) >= 1;
  }

  function separateAudioReady(): boolean {
    const audio = programAudio();
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
    const monitor = previewVolumeRef.current;
    music.muted = muted || bed <= 0 || monitor <= 0;
    music.volume = muted ? 0 : Math.max(0, Math.min(1, bed * monitor));
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
    stage.style.setProperty('--xfade-out-clip', style.outClipPath);
    stage.style.setProperty('--xfade-move', style.inTransform);
    stage.style.setProperty('--xfade-filter', style.inFilter);
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
      '--xfade-out-clip',
      '--xfade-move',
      '--xfade-filter',
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
    const audio = programAudio();
    const xfade = xfadeRef.current;
    const sourceTime = video?.currentTime ?? 0;
    const outputTime = inPadRef.current
      ? previewOutputTimeRef.current
      : outputTimeForSource(buildOutputClock(ordered), index, sourceTime);
    if (!inPadRef.current) {
      previewOutputTimeRef.current = outputTime;
    }
    const muted = previewMutedRef.current;
    const volume = previewVolumeRef.current;
    const progress = xfade ? xfadeProgress(sourceTime, ordered) : 0;
    const mix = xfade ? xfadeAudioWeights(progress) : { out: 1, in: 0 };
    const outGain = clipGainAt(index, outputTime, ordered);
    const inGain = xfade ? clipGainAt(xfade.toIndex, outputTime, ordered) : 1;
    const outVol = muted ? 0 : volume * outGain * mix.out;
    const inVol = xfade && !muted ? volume * inGain * mix.in : 0;
    const separate = separateAudioReady() && !xfade;
    const audioLive = Boolean(
      separate &&
        audio &&
        !audio.paused &&
        !audio.error &&
        audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    );
    if (xfade) applyXfadeVars(xfade.type, progress);
    if (audio) {
      const mixGain = separate ? (muted ? 0 : clampMediaVolume(volume * outGain)) : 0;
      // Keep the program <audio> unmuted while it is the output path. Muting it
      // while paused and unmuting on play() clicks, then WKWebView can stay silent.
      audio.muted = separate ? muted : true;
      audio.volume = separate ? mixGain : 0;
      if (!separate && !xfade) {
        audio.pause();
        audio.playbackRate = 1;
      }
    }
    const intendSeparate = Boolean(separate && audio && !audio.error);
    if (video) {
      video.muted = audioLive || (intendSeparate && previewingRef.current)
        ? true
        : muted || outVol <= 0.0005;
      video.volume = audioLive || intendSeparate ? 1 : clampMediaVolume(outVol);
    }
    if (standby) {
      standby.muted = Boolean(audioLive || intendSeparate || muted || inVol <= 0.0005);
      standby.volume = audioLive || intendSeparate ? 0 : clampMediaVolume(inVol);
    }
    applyMusicGain();
  }

  function ensureSeparateAudioPlaying() {
    if (!previewingRef.current || scrubbingRef.current || inPadRef.current || xfadeRef.current) {
      return;
    }
    const audio = programAudio();
    if (!separateAudioReady() || !audio || previewMutedRef.current) return;
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    }
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

  function startIncomingClip(next: ReelSegment, atSource?: number) {
    const standby = standbyVideo();
    if (!standby) return;
    const target = atSource ?? next.source_start_seconds;
    if (Math.abs(standby.currentTime - target) > 0.12) {
      setMediaTime(standby, target);
    }
    void standby.play().catch(() => undefined);
  }

  function setupXfadeFromSeek(target: PreviewSeekTarget) {
    const mix = target.xfade;
    if (!mix) {
      cancelXfade();
      return;
    }
    const ordered = orderedSegmentsRef.current;
    const type = ordered[mix.fromIndex]?.transition_type;
    if (!type || type === 'hard_cut') {
      cancelXfade();
      return;
    }
    const outLane = programLaneRef.current;
    xfadeRef.current = {
      type,
      outLane,
      fromIndex: mix.fromIndex,
      toIndex: mix.toIndex,
      duration: mix.duration,
    };
    setXfadeUi({ type, outLane });
    const standby = standbyVideo();
    if (standby) setMediaTime(standby, mix.incomingSourceTime);
    applyXfadeVars(type, mix.progress);
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
        const audio = programAudio();
        if (audio) {
          setMediaTime(
            audio,
            audioTimeForVideo(incoming.currentTime, audioOffsetRef.current),
            true,
          );
        }
      }
    }
    applyPreviewGain();
    ensureSeparateAudioPlaying();
    scheduleCutAdvance();
    prefetchStandby();
  }

  function runPreviewTick() {
    if (!previewingRef.current || scrubbingRef.current) {
      applyPreviewGain();
      return;
    }
    if (inPadRef.current) {
      const now = performance.now();
      const last = padWallRef.current || now;
      padWallRef.current = now;
      const dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
      const ordered = orderedSegmentsRef.current;
      const clock = buildOutputClock(ordered);
      const nextOut = Math.min(clock.totalDuration, previewOutputTimeRef.current + dt);
      previewOutputTimeRef.current = nextOut;
      setPreviewOutputTime(nextOut);
      syncMusicToOutput(nextOut);
      if (nextOut >= clock.totalDuration - 0.02) {
        stopPreview();
        return;
      }
      const target = resolvePreviewSeek(ordered, nextOut);
      if (!target) {
        stopPreview();
        return;
      }
      if (!target.inPad) {
        inPadRef.current = false;
        setPreviewInPad(false);
        previewIndexRef.current = target.segmentIndex;
        setPreviewIndex(target.segmentIndex);
        setSourceTime(target.sourceTime);
        void jumpPreviewToSource(target.sourceTime, true);
      }
      return;
    }
    const video = programVideo();
    const ordered = orderedSegmentsRef.current;
    const index = previewIndexRef.current;
    const current = ordered[index];
    if (!video || !current) return;
    const outputNow = outputTimeForSource(buildOutputClock(ordered), index, video.currentTime);
    previewOutputTimeRef.current = Math.max(0, outputNow);
    setPreviewOutputTime(previewOutputTimeRef.current);
    setSourceTime(video.currentTime);
    if (jumpingRef.current) {
      applyPreviewGain();
      return;
    }
    applyPreviewGain();
    ensureSeparateAudioPlaying();
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
        startIncomingClip(next, next.source_start_seconds);
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
    inPadRef.current = false;
    setPreviewInPad(false);
    videoARef.current?.pause();
    videoBRef.current?.pause();
    assembledVideoRef.current?.pause();
    const audio = programAudio();
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
    if (overlapMs > 0) return;
    cutTimerRef.current = window.setTimeout(() => {
      cutTimerRef.current = null;
      advanceToNextCut();
    }, Math.max(0, remainingMs - 30));
  }

  function advanceToNextCut() {
    if (jumpingRef.current || !previewingRef.current || scrubbingRef.current) return;
    if (xfadeRef.current) {
      const current = orderedSegmentsRef.current[previewIndexRef.current];
      const video = programVideo();
      const remaining = current && video ? current.source_end_seconds - video.currentTime : 0;
      if (remaining > 0.04) return;
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
    const nextPlacement = buildOutputClock(ordered).placements[index + 1];
    if (nextPlacement && nextPlacement.padSeconds > 0.02) {
      previewIndexRef.current = index + 1;
      setPreviewIndex(index + 1);
      video.pause();
      standbyVideo()?.pause();
      const padAudio = programAudio();
      if (padAudio) {
        padAudio.pause();
        padAudio.playbackRate = 1;
      }
      inPadRef.current = true;
      setPreviewInPad(true);
      padWallRef.current = performance.now();
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
    const audio = programAudio();
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
    const audio = programAudio();
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
      applyPreviewGain();
      ensureSeparateAudioPlaying();
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
      if (video.paused) await video.play();
      if (separateAudioReady() && audio && audio.paused) await audio.play();
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
    inPadRef.current = Boolean(target.inPad);
    setPreviewInPad(Boolean(target.inPad));
    if (target.inPad) {
      cancelXfade();
      video.pause();
      standbyVideo()?.pause();
      programAudio()?.pause();
      return;
    }
    if (target.xfade) {
      setupXfadeFromSeek(target);
      pendingVideoTimeRef.current = target.sourceTime;
      if (setMediaTime(video, target.sourceTime, true)) {
        pendingVideoTimeRef.current = null;
      }
      const standby = standbyVideo();
      if (standby) setMediaTime(standby, target.xfade.incomingSourceTime, true);
      applyPreviewGain();
      return;
    }
    cancelXfade();
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
    if (!target.xfade) cancelXfade();
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
    const scrubAudio = programAudio();
    if (scrubAudio) {
      scrubAudio.pause();
      scrubAudio.playbackRate = 1;
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
      if (target.inPad) {
        inPadRef.current = true;
        setPreviewInPad(true);
        programVideo()?.pause();
        if (shouldResume) {
          padWallRef.current = performance.now();
          ensurePreviewTick();
        }
      } else if (target.xfade) {
        inPadRef.current = false;
        setPreviewInPad(false);
        applyPreviewSeek(target, false);
        if (shouldResume) {
          void programVideo()?.play().catch(() => undefined);
          void standbyVideo()?.play().catch(() => undefined);
          ensurePreviewTick();
        }
      } else {
        inPadRef.current = false;
        setPreviewInPad(false);
        void jumpPreviewToSource(target.sourceTime, shouldResume);
      }
    }
    pendingPreviewSeekRef.current = null;
  }

  function startPreview() {
    if (!activeReel || activeReel.segments.length === 0) {
      return;
    }
    const video = programVideo();
    if (!video) return;
    const total = outputClock.totalDuration;
    const target =
      previewOutputTime >= total - 0.05
        ? resolvePreviewSeek(orderedSegments, 0)
        : resolvePreviewSeek(orderedSegments, previewOutputTime);
    if (!target) return;
    previewIndexRef.current = target.segmentIndex;
    setPreviewIndex(target.segmentIndex);
    setPreviewOutputTime(target.outputTime);
    previewOutputTimeRef.current = target.outputTime;
    setSourceTime(target.sourceTime);
    pendingPreviewSeekRef.current = target;
    previewMutedRef.current = previewMuted;
    previewVolumeRef.current = previewVolume;
    previewingRef.current = true;
    setPreviewing(true);
    applyPreviewGain();
    if (target.inPad) {
      inPadRef.current = true;
      setPreviewInPad(true);
      padWallRef.current = performance.now();
      video.pause();
      standbyVideo()?.pause();
      programAudio()?.pause();
      void playMusicForOutput(target.outputTime);
      ensurePreviewTick();
      return;
    }
    jumpingRef.current = false;
    inPadRef.current = false;
    setPreviewInPad(false);
    pendingVideoTimeRef.current = target.sourceTime;
    if (setMediaTime(video, target.sourceTime, true)) {
      pendingVideoTimeRef.current = null;
    }
    const audio = programAudio();
    if (usesSeparateAudio() && audio) {
      const audioTime = audioTimeForVideo(target.sourceTime, audioOffsetRef.current);
      pendingAudioTimeRef.current = audioTime;
      if (setMediaTime(audio, audioTime, true)) {
        pendingAudioTimeRef.current = null;
      }
    }
    if (target.xfade) {
      setupXfadeFromSeek(target);
      const standby = standbyVideo();
      if (standby) {
        setMediaTime(standby, target.xfade.incomingSourceTime);
        void standby.play().catch(() => undefined);
      }
    } else {
      cancelXfade();
    }
    applyPreviewGain();
    ensurePreviewTick();
    if (video.paused) {
      void video.play().catch((err: unknown) => {
        if (!previewingRef.current) return;
        stopPreview();
        setError(err instanceof Error ? err.message : 'El navegador bloqueó la reproducción');
      });
    }
    if (usesSeparateAudio() && audio && audio.paused && !previewMuted) {
      void audio.play().catch(() => undefined);
    }
    scheduleCutAdvance();
    prefetchStandby();
    void playMusicForOutput(target.outputTime);
  }

  function togglePreviewAudio() {
    const silent = previewMuted || previewVolume <= 0;
    if (!silent && previewVolume > 0) lastHeardVolumeRef.current = previewVolume;
    const nextMuted = !silent;
    const nextVolume = nextMuted ? 0 : lastHeardVolumeRef.current || 0.8;
    setPreviewMuted(nextMuted);
    setPreviewVolume(nextVolume);
    previewMutedRef.current = nextMuted;
    previewVolumeRef.current = nextVolume;
    applyPreviewGain();
    applyMusicGain();
  }

  function changePreviewVolume(value: number) {
    const nextVolume = Math.max(0, Math.min(value, 1));
    const nextMuted = nextVolume === 0;
    if (nextVolume > 0) lastHeardVolumeRef.current = nextVolume;
    setPreviewMuted(nextMuted);
    previewMutedRef.current = nextMuted;
    previewVolumeRef.current = nextVolume;
    setPreviewVolume(nextVolume);
    applyPreviewGain();
    applyMusicGain();
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
      if (!video || event.target !== video || jumpingRef.current || inPadRef.current) return;
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

    function onAudioReady(event: Event) {
      const el = event.target;
      if (!(el instanceof HTMLAudioElement) || el !== programAudio()) return;
      if (pendingAudioTimeRef.current != null) {
        if (setMediaTime(el, pendingAudioTimeRef.current)) {
          pendingAudioTimeRef.current = null;
        }
      }
      applyPreviewGain();
      if (previewingRef.current) ensureSeparateAudioPlaying();
    }

    for (const syncedVideo of videos) {
      syncedVideo.addEventListener('timeupdate', onTimeUpdate);
      syncedVideo.addEventListener('seeking', onSeeking);
      syncedVideo.addEventListener('loadedmetadata', onVideoMetadata);
    }
    if (previewAudio) {
      previewAudio.addEventListener('loadedmetadata', onAudioReady);
      previewAudio.addEventListener('canplay', onAudioReady);
    }
    return () => {
      for (const syncedVideo of videos) {
        syncedVideo.removeEventListener('timeupdate', onTimeUpdate);
        syncedVideo.removeEventListener('seeking', onSeeking);
        syncedVideo.removeEventListener('loadedmetadata', onVideoMetadata);
      }
      if (previewAudio) {
        previewAudio.removeEventListener('loadedmetadata', onAudioReady);
        previewAudio.removeEventListener('canplay', onAudioReady);
      }
    };
  }, [activeReel, programLane, audioSrc, hasVideo]);

  useEffect(() => {
    setAudioSrc(projectAudioUrl(projectId, mediaRevision));
  }, [projectId, mediaRevision]);

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
      programAudio()?.pause();
    };

    const showSourceFrame = (sourceSeconds: number) => {
      const video = programVideo() ?? videoARef.current;
      const audio = programAudio();
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
    if (!active) return;
    void listAnalysisCandidates(projectId)
      .then((response) => setAnalysisCandidates(response.items))
      .catch(() => setAnalysisCandidates([]));
  }, [projectId, refreshToken, active]);

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
  const selectedHasTransition =
    Boolean(selectedSegment) &&
    selectedClipIndex >= 0 &&
    Boolean(orderedSegments[selectedClipIndex + 1]) &&
    selectedSegment != null &&
    selectedSegment.transition_type !== 'hard_cut';
  const transitionDurationMs =
    selectedHasTransition && selectedSegment
      ? clampTransitionMs(selectedSegment.transition_duration_ms || trayTransitionMs)
      : trayTransitionMs;
  const playingSegment = orderedSegments[previewIndex] ?? selectedSegment;
  const playingPlacement = outputClock.placements[previewIndex] ?? selectedClipPlacement;
  clipEnvelopeRef.current = {
    keys: playingSegment?.volume_keyframes,
    outputStart: playingPlacement?.outputStart ?? 0,
  };
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
    const overlay = overlays.find((item) => item.id === overlayId);
    if (overlay?.kind === 'text') {
      setActiveTool('text');
      openInspectorExclusive();
    } else if (overlay?.kind === 'image') {
      setActiveTool('files');
      openInspectorExclusive();
    }
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
        else setError('Unir corte solo funciona en un corte que hayas hecho tú. Coloca el cursor en esa unión.');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const nleActive = Boolean(activeReel);
  const openAnalysisCandidates = visibleAnalysisCandidates(analysisCandidates);
  const addedCandidateIds = addedCandidateIdsOnReel(
    analysisCandidates,
    activeReel?.id,
    activeReel?.segments ?? [],
  );
  const addableForActiveReel = addableAnalysisCandidates(
    analysisCandidates,
    activeReel?.id,
    addedCandidateIds,
  );
  const originWindows = originWindowsForReel(analysisCandidates, activeReel?.id);
  const activeToolLabel =
    REEL_TOOLS.find((tool) => tool.id === activeTool)?.label ?? 'Cortes';

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

      {!activeReel && openAnalysisCandidates.length > 0 && (
        <div className="analysis-candidates">
          <h3>Propuestas del análisis</h3>
          <p className="muted">
            Elige una para editarla como short, o crea un Reel vacío y luego añade fragmentos a
            ese short.
          </p>
          <AnalysisProposalList
            candidates={openAnalysisCandidates}
            busy={busy}
            onEdit={(candidate) => void handleEditAnalysisCandidate(candidate)}
          />
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
                <ReelPicker
                  items={reels}
                  value={activeReel.id}
                  onChange={(id) => {
                    const reel = reels.find((item) => item.id === id);
                    if (!reel) return;
                    stopPreview();
                    setEditingSegmentId(null);
                    setActiveReelId(reel.id);
                    setAspect(reel.aspect_ratio);
                  }}
                />
              </div>
            );
            if (!active) return null;
            return chromeSlot ? createPortal(reelBar, chromeSlot) : reelBar;
          })()}
          <div className="reel-nle__top">
            <nav className="reel-nle__tools" aria-label="Herramientas del editor">
              <div className="reel-nle__tools-track" role="tablist">
                {layout.previewCollapsed ? (
                  <button
                    type="button"
                    className="reel-nle__tool reel-nle__tool--icon"
                    data-tooltip="Mostrar vista previa"
                    aria-label="Mostrar vista previa"
                    onClick={() => patchLayout({ previewCollapsed: false })}
                  >
                    <MonitorPlay size={14} strokeWidth={2} aria-hidden />
                  </button>
                ) : null}
                {REEL_TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  return (
                  <button
                    key={tool.id}
                    id={`reel-tool-tab-${tool.id}`}
                    type="button"
                    role="tab"
                    title={tool.description}
                    aria-selected={activeTool === tool.id && !inspectorCollapsed}
                    aria-expanded={activeTool === tool.id && !inspectorCollapsed}
                    aria-controls={`reel-tool-panel-${tool.id}`}
                    className={`reel-nle__tool${
                      activeTool === tool.id && !inspectorCollapsed ? ' reel-nle__tool--active' : ''
                    }`}
                    onClick={() => {
                      if (activeTool === tool.id && !inspectorCollapsed) {
                        if (layout.previewCollapsed) {
                          patchLayout({ previewCollapsed: false });
                        }
                        setInspectorCollapsed(true);
                        return;
                      }
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
              className={`reel-nle__workspace${
                inspectorCollapsed ? ' reel-nle__workspace--inspector-collapsed' : ''
              }${
                layout.previewCollapsed ? ' reel-nle__workspace--preview-collapsed' : ''
              }`}
              style={{
                ['--nle-inspector' as string]: inspectorCollapsed
                  ? '0px'
                  : `${layout.inspectorPx}px`,
              }}
            >
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
                  audioSrc={audioSrc}
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
                  onTextSizeOverlay={(overlayId, fontSize) => {
                    const overlay = overlays.find((item) => item.id === overlayId);
                    if (overlay?.kind === 'text') {
                      void handleOverlayField(overlay, {
                        style_json: mergeTextOverlayStyle(overlay, { font_size: fontSize }),
                      });
                    }
                  }}
                  onAssembledTime={() => undefined}
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
                  inPad={previewInPad}
                  onMinimize={() => {
                    patchLayout({ previewCollapsed: true });
                    setInspectorCollapsed(false);
                  }}
                  dualMonitors={layout.dualMonitors}
                  onToggleSource={(enabled) => patchLayout({ dualMonitors: enabled })}
                />
                </div>
              ) : (
                <div className="reel-nle__stage-empty">
                  <p className="muted">
                    {hasVideo
                      ? 'Añade al menos un fragmento para ver la vista previa.'
                      : 'Carga un video del proyecto para previsualizar el Reel.'}
                  </p>
                  {addableForActiveReel.length > 0 && (
                    <>
                      <h3>Propuestas del análisis</h3>
                      <AnalysisProposalList
                        compact
                        candidates={addableForActiveReel}
                        busy={busy}
                        canAddToReel
                        addedCandidateIds={addedCandidateIds}
                        currentReelId={activeReel.id}
                        currentReelTitle={activeReel.title}
                        onEdit={(candidate) => void handleEditAnalysisCandidate(candidate)}
                        onAddToReel={(candidate) => void handleAddAnalysisCandidate(candidate)}
                      />
                    </>
                  )}
                </div>
              )}
              {hasVideo && orderedSegments.length > 0 && (
                <PreviewTransport
                  outputTime={previewOutputTime}
                  totalDuration={outputClock.totalDuration}
                  previewing={previewing}
                  previewMuted={previewMuted}
                  previewVolume={previewVolume}
                  onTogglePlay={togglePlayFromTransport}
                  onSeek={seekPreview}
                  onScrubStart={beginPreviewScrub}
                  onScrubEnd={endPreviewScrub}
                  onToggleMute={togglePreviewAudio}
                  onPreviewVolume={changePreviewVolume}
                />
              )}
            </div>

            <NleSplitter
              label="Ancho del inspector"
              onDrag={(delta) => {
                const workspace = nleMainRef.current?.querySelector('.reel-nle__workspace');
                const width = workspace instanceof HTMLElement ? workspace.clientWidth : 1200;
                patchLayout({
                  inspectorPx: Math.min(
                    maxInspectorForWorkspace(width),
                    layout.inspectorPx - delta,
                  ),
                });
              }}
            />
            <aside className={`reel-nle__inspector reel-nle__inspector--${activeTool}${
              inspectorCollapsed ? ' reel-nle__inspector--collapsed' : ''
            }`}>
              {!inspectorCollapsed && (
              <>
                <h3 className="reel-nle__inspector-title">{activeToolLabel}</h3>
              <div
                id="reel-tool-panel-files"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-files"
                hidden={activeTool !== 'files'}
              >
                <div className="reel-nle__files-workspace">
                  <MediaBinPanel
                    projectId={projectId}
                    assets={assets}
                    onAssetsChange={setAssets}
                    onAddAtPlayhead={(assetId) => void handleDropAsset(assetId, previewOutputTime)}
                    analysisCandidates={openAnalysisCandidates}
                    onAddCandidate={(candidate) => void handleAddAnalysisCandidate(candidate)}
                    candidatesBusy={busy}
                    addedCandidateIds={addedCandidateIds}
                    currentReelId={activeReel.id}
                  />
                  {selectedOverlay?.kind === 'image' && (
                    <OverlayInspector
                      overlay={selectedOverlay}
                      busy={busy}
                      compact
                      onChange={(patch) => void handleOverlayField(selectedOverlay, patch)}
                      onDelete={() => void handleDeleteOverlay(selectedOverlay.id)}
                    />
                  )}
                </div>
              </div>
              <div
                id="reel-tool-panel-cuts"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-cuts"
                hidden={activeTool !== 'cuts'}
              >
                <div className="reel-nle__inspector-section reel-nle__cuts-workspace">
                  {addableForActiveReel.length > 0 && (
                    <div className="analysis-candidates">
                      <h3 className="reel-nle__cuts-title">Propuestas del análisis</h3>
                      <p className="muted">
                        Edita otra propuesta o añádela a «{activeReel.title}».
                      </p>
                      <AnalysisProposalList
                        compact
                        candidates={addableForActiveReel}
                        busy={busy}
                        canAddToReel
                        addedCandidateIds={addedCandidateIds}
                        currentReelId={activeReel.id}
                        currentReelTitle={activeReel.title}
                        onEdit={(candidate) => void handleEditAnalysisCandidate(candidate)}
                        onAddToReel={(candidate) => void handleAddAnalysisCandidate(candidate)}
                      />
                    </div>
                  )}
                  <div className="reel-nle__cuts-toolbar">
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
                      canRemove={
                        clipDeleteAction(orderedSegments, selectedSegment.id, originWindows) !==
                        'keep'
                      }
                      removeTitle={
                        clipDeleteAction(orderedSegments, selectedSegment.id, originWindows) ===
                        'keep'
                          ? 'El video del fragmento elegido no se puede eliminar'
                          : undefined
                      }
                      onAdjustEdge={(edge, delta) => void adjustEdge(selectedSegment, edge, delta)}
                      onField={(patch) => void handleSegmentField(selectedSegment, patch)}
                      onAcceptCut={(suggestion) => void handleAcceptCut(suggestion)}
                      onRejectCut={(suggestion) => void handleRejectCut(suggestion)}
                    />
                  )}

                  <div className="cuts-reel-meta">
                    <label className="field cuts-reel-meta__title">
                      <span>Título</span>
                      <input
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label className="field cuts-reel-meta__format">
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
                    <div className="cuts-reel-meta__actions">
                      <button
                        type="button"
                        className="button button--secondary button--inline"
                        onClick={() => void handleCreateEmpty()}
                        disabled={busy}
                      >
                        Nuevo vacío
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--inline"
                        onClick={() => void handleCreateFromSelection()}
                        disabled={busy || selectedTranscriptIds.length === 0}
                      >
                        Desde selección
                      </button>
                      <button
                        type="button"
                        className="button button--secondary button--inline"
                        onClick={() => void handleAppendFromSelection()}
                        disabled={busy || selectedTranscriptIds.length === 0}
                      >
                        Añadir selección
                      </button>
                    </div>
                  </div>
                  <details className="reel-nle__details">
                    <summary>Añadir desde transcripción</summary>
                    <div className="reel-picker reel-picker--compact">
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
                  <section className="cuts-review">
                    <CutSuggestionsPanel
                      projectId={projectId}
                      reelId={activeReel.id}
                      segmentIds={orderedSegments.map((segment) => segment.id)}
                      onReelChange={replaceReel}
                      onReportChange={setCutReport}
                    />
                    <CoherencePanel
                      projectId={projectId}
                      reelId={activeReel.id}
                      segments={orderedSegments}
                      onReelChange={replaceReel}
                      originWindows={originWindows}
                    />
                  </section>
                </div>
              </div>

              <div
                id="reel-tool-panel-text"
                role="tabpanel"
                aria-labelledby="reel-tool-tab-text"
                hidden={activeTool !== 'text'}
              >
                <TextOverlayPanel
                  overlay={selectedOverlay?.kind === 'text' ? selectedOverlay : null}
                  busy={busy}
                  onAdd={() => void handleAddTextOverlay(previewOutputTime)}
                  onChange={(patch) => {
                    if (selectedOverlay?.kind === 'text') {
                      void handleOverlayField(selectedOverlay, patch);
                    }
                  }}
                  onDelete={() => {
                    if (selectedOverlay?.kind === 'text') {
                      void handleDeleteOverlay(selectedOverlay.id);
                    }
                  }}
                />
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
                <p className="muted">
                  Arrastra un efecto y suéltalo en el corte entre dos clips. El efecto cubre el
                  final del primero y el inicio del segundo; los fragmentos no se mueven.
                </p>
                <div className="reel-nle__fx-duration">
                  <label className="reel-nle__fx-duration-label" htmlFor="reel-fx-duration">
                    <span>Duración</span>
                    <output htmlFor="reel-fx-duration">
                      {formatTransitionSeconds(transitionDurationMs)}
                    </output>
                  </label>
                  <input
                    id="reel-fx-duration"
                    type="range"
                    min={MIN_TRANSITION_MS}
                    max={MAX_TRANSITION_MS}
                    step={10}
                    value={transitionDurationMs}
                    aria-valuemin={MIN_TRANSITION_MS}
                    aria-valuemax={MAX_TRANSITION_MS}
                    aria-valuenow={transitionDurationMs}
                    aria-valuetext={formatTransitionSeconds(transitionDurationMs)}
                    aria-label="Duración de la transición"
                    onChange={(event) => {
                      const nextMs = clampTransitionMs(Number(event.target.value));
                      setTrayTransitionMs(nextMs);
                      if (selectedHasTransition && selectedSegment) {
                        handleSegmentField(selectedSegment, { transition_duration_ms: nextMs });
                      }
                    }}
                  />
                  <div className="reel-nle__fx-duration-presets" role="group" aria-label="Tiempos de transición">
                    {TRANSITION_DURATION_PRESETS_MS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`reel-nle__fx-duration-chip${
                          transitionDurationMs === preset ? ' reel-nle__fx-duration-chip--active' : ''
                        }`}
                        onClick={() => {
                          setTrayTransitionMs(preset);
                          if (selectedHasTransition && selectedSegment) {
                            handleSegmentField(selectedSegment, { transition_duration_ms: preset });
                          }
                        }}
                      >
                        {formatTransitionSeconds(preset).replace(' s', 's')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="reel-nle__fx-tray reel-nle__fx-tray--panel" aria-label="Transiciones">
                  {TRAY_TRANSITION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="reel-nle__fx-card"
                      draggable
                      title={`Arrastra «${option.label}» (${formatTransitionSeconds(transitionDurationMs)}) entre dos clips`}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy';
                        event.dataTransfer.setData(TRANSITION_MIME, option.value);
                        event.dataTransfer.setData(
                          TRANSITION_DURATION_MIME,
                          String(transitionDurationMs),
                        );
                        event.dataTransfer.setData('text/plain', option.value);
                      }}
                    >
                      <TransitionGlyph type={option.value} className="reel-nle__fx-glyph" />
                      <span>{option.label}</span>
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
                  onRestoreCaptions={handleRestoreCaptions}
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
                <AudioExportPanel
                  projectId={projectId}
                  normalizeLoudness={normalizeLoudness}
                  onNormalizeChange={setNormalizeLoudness}
                />
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
                  framingMode={activeReel.framing_mode}
                  subtitleEnabled={activeReel.subtitle_enabled}
                  normalizeLoudness={normalizeLoudness}
                  onBeforeStart={flushPendingEditsForExport}
                  onGoToCuts={() => setActiveTool('cuts')}
                />
              </div>
              {((selectedOverlay &&
                selectedOverlay.kind !== 'text' &&
                selectedOverlay.kind !== 'image') ||
                (!selectedOverlay &&
                  selectedSegment &&
                  activeTool !== 'files' &&
                  activeTool !== 'cuts' &&
                  activeTool !== 'text' &&
                  activeTool !== 'transitions' &&
                  activeTool !== 'audio' &&
                  activeTool !== 'end-card')) && (
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
                      canRemove={
                        clipDeleteAction(orderedSegments, selectedSegment.id, originWindows) !==
                        'keep'
                      }
                      removeTitle={
                        clipDeleteAction(orderedSegments, selectedSegment.id, originWindows) ===
                        'keep'
                          ? 'El video del fragmento elegido no se puede eliminar'
                          : undefined
                      }
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
                const slot = timelineSlotRef.current;
                const content =
                  slot instanceof HTMLElement ? measureTimelineContentPx(slot) : timelineContentMax;
                const max = Math.max(1, Math.min(content, timelineContentMax, mainH - 180));
                const min = Math.min(TIMELINE_MIN, max);
                patchLayout({
                  timelinePx: Math.min(max, Math.max(min, layout.timelinePx - delta)),
                });
              }}
            />
            <div
              ref={timelineSlotRef}
              className="reel-nle__timeline-slot"
              style={{
                flexBasis: `${Math.min(layout.timelinePx, timelineContentMax)}px`,
                height: `${Math.min(layout.timelinePx, timelineContentMax)}px`,
              }}
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
            onMoveVideoPad={handleMoveVideoPad}
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
            onDeleteSegments={(ids) => void handleDeleteCuts(ids)}
            captionsEnabled={activeReel.subtitle_enabled}
            onDeleteCaptions={(ids) => void handleDeleteCaptions(ids)}
            onRestoreCaptions={handleRestoreCaptions}
            originWindows={originWindows}
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

    </section>
  );
}
