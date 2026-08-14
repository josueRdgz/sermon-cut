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
import { getTranscript } from '../api/transcripts';
import { projectVideoUrl } from '../api/projects';
import type { Project } from '../types/project';
import type { AspectRatio, Reel, ReelSegment, TransitionType } from '../types/reel';
import type { TranscriptSegment } from '../types/transcript';
import { formatDuration, formatTimecode } from '../utils/format';
import { pinWorkspaceNav } from '../utils/workspaceScroll';
import { ConfirmDialog } from './ConfirmDialog';
import { CutSuggestionMarkers, CutSuggestionsPanel } from './CutSuggestionsPanel';
import { BackgroundMusicPanel } from './BackgroundMusicPanel';
import { EndCardPanel } from './EndCardPanel';
import { FramingPanel } from './FramingPanel';
import { RenderPanel } from './RenderPanel';
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
 * Saved per-cut caption wins. If missing, show Whisper words inside the cut.
 * Legacy builds sometimes stored the full Whisper span on every fragment — ignore
 * that for display so the textarea shows the cut window, not the whole sermon.
 */
function fragmentCaptionBaseline(
  segment: ReelSegment,
  transcriptSegments: TranscriptSegment[],
): string {
  const preview = captionPreviewForCut(
    transcriptSegments,
    segment.source_start_seconds,
    segment.source_end_seconds,
  );
  const saved = segment.transcript_text?.trim() ?? '';
  if (!saved) return preview;

  const liveJoined = overlappingTranscriptSegments(
    transcriptSegments,
    segment.source_start_seconds,
    segment.source_end_seconds,
  )
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  const savedTokens = saved.split(/\s+/).filter(Boolean);
  const previewTokens = preview.split(/\s+/).filter(Boolean);
  if (
    liveJoined &&
    saved.toLocaleLowerCase() === liveJoined.toLocaleLowerCase() &&
    previewTokens.length > 0 &&
    savedTokens.length > previewTokens.length + 1
  ) {
    return preview;
  }
  return saved;
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
  { value: 'short_crossfade', label: 'Fundido corto' },
  { value: 'dip_to_black', label: 'Fundido a negro' },
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

function defaultTransitionMs(type: TransitionType): number {
  if (type === 'hard_cut') return 0;
  if (type === 'short_crossfade') return 250;
  return 400;
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

  async function saveFragmentCaption(segment: ReelSegment) {
    if (!activeReel) return;
    const baseline = fragmentCaptionBaseline(segment, timedTranscript);
    const draft = (transcriptDrafts[segment.id] ?? baseline).trim();
    if (!draft) {
      setError('El subtítulo del fragmento no puede quedar vacío. Usa “Texto del video” para restablecer.');
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
    } finally {
      setTranscriptSavingId(null);
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

  function syncMusicToOutput(outputSeconds: number, force = false) {
    const music = musicRef.current;
    const settings = backgroundMusic;
    if (!music || !musicPreviewActive(settings) || !settings) return;
    const start = settings.start_seconds ?? 0;
    const end = settings.end_seconds;
    const target = start + Math.max(0, outputSeconds);
    if (end != null && target >= end) {
      music.pause();
      return;
    }
    if (music.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const drift = target - music.currentTime;
    if (force || Math.abs(drift) >= 0.12) {
      void waitForSeek(music, target);
    }
  }

  async function playMusicForOutput(outputSeconds: number) {
    const music = musicRef.current;
    const settings = backgroundMusic;
    if (!music || !musicPreviewActive(settings) || !settings || previewMutedRef.current) {
      music?.pause();
      return;
    }
    applyMusicGain(settings);
    const start = settings.start_seconds ?? 0;
    const end = settings.end_seconds;
    const target = start + Math.max(0, outputSeconds);
    if (end != null && target >= end) {
      music.pause();
      return;
    }
    await waitForSeek(music, target);
    try {
      await music.play();
    } catch {
      // Autoplay can fail if the bed is still buffering; voice preview continues.
    }
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
    musicRef.current?.pause();
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

  async function savePreviewMusicVolume(volume: number) {
    const clamped = Math.max(0, Math.min(volume, 1));
    setMusicVolumeSaving(true);
    try {
      const next = await saveBackgroundMusic(projectId, { volume: clamped });
      setBackgroundMusic(next);
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

  useEffect(
    () => () => {
      if (seekAnimationFrameRef.current != null) {
        window.cancelAnimationFrame(seekAnimationFrameRef.current);
      }
      if (audioOffsetSeekTimerRef.current != null) {
        window.clearTimeout(audioOffsetSeekTimerRef.current);
      }
    },
    [],
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
      {error && !activeReel && <p className="error">{error}</p>}

      {reels.length > 0 && (
        <div className="reel-selection">
          <h3>Selecciona un Reel para editarlo</h3>
          <p className="muted">
            Se muestra un solo Reel a la vez. El reproductor queda limitado a sus cortes.
          </p>
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

      {activeReel && (
        <div className="reel-editor__sticky-header">
          <div className="reel-editor__active-reel">
            <div className="reel-editor__active-reel-title">
              <small>Reel en edición</small>
              <strong>
                {reels.findIndex((reel) => reel.id === activeReel.id) + 1}. {activeReel.title}
              </strong>
              <span className={`badge badge--${activeReel.status}`}>{activeReel.status}</span>
            </div>
            {reels.length > 1 && (
              <label className="reel-editor__active-reel-picker">
                <span>Cambiar Reel</span>
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
          </div>

          <nav className="editor-tool-nav" aria-label="Herramientas del editor">
            <div className="editor-tool-nav__track" role="tablist">
              {REEL_TOOLS.map((tool, index) => (
                <button
                  key={tool.id}
                  id={`reel-tool-tab-${tool.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTool === tool.id}
                  aria-controls={`reel-tool-panel-${tool.id}`}
                  className={`editor-tool-nav__tab${
                    activeTool === tool.id ? ' editor-tool-nav__tab--active' : ''
                  }`}
                  onClick={() => {
                    setActiveTool(tool.id);
                    window.requestAnimationFrame(pinWorkspaceNav);
                  }}
                >
                  <span className="editor-tool-nav__number">{index + 1}</span>
                  <span>
                    <strong>{tool.label}</strong>
                    <small>{tool.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </nav>
          {error && <p className="error editor-sticky-notice">{error}</p>}
        </div>
      )}

      <div id="reel-tool-panel-cuts-create" hidden={Boolean(activeReel) && activeTool !== 'cuts'}>
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
              onClick={() => openAddFragmentForm()}
              disabled={busy}
            >
              Añadir otro fragmento
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={() => setConfirmDeleteReel(true)}
              disabled={busy}
            >
              Eliminar Reel
            </button>
          </div>

          {showAddFragment && (
            <div className="reel-add-fragment">
              <p className="reel-add-fragment__title">Nuevo fragmento</p>
              <p className="muted reel-add-fragment__hint">
                Elige el pedazo del video fuente (inicio y fin). Duración:{' '}
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
                  onClick={() => sourceTime != null && setAddFragmentStart(round3(sourceTime))}
                >
                  Usar tiempo actual
                </button>
                <button
                  type="button"
                  className="button button--inline"
                  disabled={busy}
                  onClick={() => void jumpPreviewToSource(addFragmentStart, false)}
                >
                  Ir al inicio
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
                  Usar tiempo actual
                </button>
                <button
                  type="button"
                  className="button button--inline"
                  disabled={busy}
                  onClick={() => void jumpPreviewToSource(addFragmentEnd, false)}
                >
                  Ir al fin
                </button>
              </div>
              <div className="reel-add-fragment__actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void handleAddManualFragment()}
                >
                  Añadir fragmento
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

          {hasVideo && orderedSegments.length > 0 && (
            <div className="reel-preview">
              <div className="reel-player">
                <video
                  ref={videoRef}
                  className="transcript-editor__video"
                  controls={false}
                  disablePictureInPicture
                  playsInline
                  preload="auto"
                  src={projectVideoUrl(projectId, mediaRevision)}
                >
                  Tu navegador no soporta video HTML5.
                </video>
                <div id="reel-subtitle-overlay" className="reel-player__subtitle-slot" />
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
              <div className="reel-preview__controls">
                <button
                  type="button"
                  onClick={() => (previewing ? stopPreview() : startPreview())}
                  disabled={orderedSegments.length === 0}
                >
                  {previewing ? 'Pausar' : 'Reproducir Reel'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(activeReel.content_duration_seconds, 0.01)}
                  step={0.05}
                  value={Math.min(previewOutputTime, activeReel.content_duration_seconds)}
                  disabled={orderedSegments.length === 0}
                  aria-label="Posición dentro del Reel"
                  onChange={(event) => seekPreview(Number(event.target.value))}
                  onPointerDown={beginPreviewScrub}
                  onPointerUp={endPreviewScrub}
                  onPointerCancel={endPreviewScrub}
                  onBlur={endPreviewScrub}
                />
                <span className="reel-preview__time">
                  {formatDuration(previewOutputTime)} /{' '}
                  {formatDuration(activeReel.content_duration_seconds)}
                </span>
                <button
                  type="button"
                  className="button button--secondary"
                  aria-pressed={previewMuted}
                  onClick={togglePreviewAudio}
                >
                  {previewMuted ? 'Activar audio' : 'Silenciar'}
                </button>
                <label className="reel-preview__volume">
                  <span>Voz</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={previewMuted ? 0 : previewVolume}
                    onChange={(event) => changePreviewVolume(Number(event.target.value))}
                  />
                </label>
                {musicPreviewActive() && backgroundMusic && (
                  <label className="reel-preview__volume">
                    <span>Música {Math.round(backgroundMusic.volume * 100)}%</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={previewMuted ? 0 : backgroundMusic.volume}
                      disabled={musicVolumeSaving}
                      onChange={(event) => {
                        const volume = Number(event.target.value);
                        setBackgroundMusic({ ...backgroundMusic, volume });
                        applyMusicGain({ ...backgroundMusic, volume });
                      }}
                      onPointerUp={(event) =>
                        void savePreviewMusicVolume(
                          Number((event.target as HTMLInputElement).value),
                        )
                      }
                      onBlur={(event) =>
                        void savePreviewMusicVolume(Number(event.target.value))
                      }
                    />
                  </label>
                )}
              </div>
              <div className="reel-audio-sync" hidden={activeTool !== 'audio'}>
                <div className="reel-audio-sync__header">
                  <label htmlFor={`audio-sync-${activeReel.id}`}>
                    Sincronía del audio original del video:{' '}
                    <strong>
                      {audioOffsetMs === 0
                        ? '0 ms'
                        : audioOffsetMs > 0
                          ? `+${audioOffsetMs} ms (retrasar)`
                          : `${audioOffsetMs} ms (adelantar)`}
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
                      {audioOffsetSaving ? 'Guardando…' : 'Guardar sincronía'}
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
                      Restablecer
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
                <div className="reel-audio-sync__scale" aria-hidden="true">
                  <span>−1 s · adelantar</span>
                  <span>0</span>
                  <span>retrasar · +1 s</span>
                </div>
                <p className="muted">
                  Este ajuste adelanta o retrasa únicamente el audio contenido en el video; no
                  desplaza la música de fondo. Se guarda automáticamente y Exportar usa siempre el
                  valor visible.
                </p>
              </div>
            </div>
          )}
          {hasVideo && orderedSegments.length === 0 && (
            <p className="muted">Añade al menos un fragmento para mostrar la vista previa.</p>
          )}

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
            />
          </div>

          <div
            id="reel-tool-panel-cuts"
            role="tabpanel"
            aria-labelledby="reel-tool-tab-cuts"
            hidden={activeTool !== 'cuts'}
          >
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

                    {(() => {
                      const baseline = fragmentCaptionBaseline(segment, timedTranscript);
                      const draft = transcriptDrafts[segment.id] ?? baseline;
                      const dirty = draft !== baseline;
                      const saving = transcriptSavingId === segment.id;
                      const hasCustom = Boolean(segment.transcript_text?.trim());
                      return (
                        <div className="reel-transcript-form">
                          <p className="reel-transcript-form__label">
                            Subtítulos de este fragmento
                          </p>
                          <p className="muted reel-transcript-form__meta">
                            Solo afecta a este corte. No modifica la transcripción del proyecto.
                          </p>
                          <textarea
                            rows={3}
                            value={draft}
                            disabled={saving || busy}
                            placeholder="Texto que debe verse en este fragmento…"
                            onChange={(event) =>
                              setTranscriptDrafts((current) => ({
                                ...current,
                                [segment.id]: event.target.value,
                              }))
                            }
                          />
                          <div className="reel-transcript-form__actions">
                            <button
                              type="button"
                              className="button button--inline"
                              disabled={saving || busy || !dirty || !draft.trim()}
                              onClick={() => void saveFragmentCaption(segment)}
                            >
                              {saving ? 'Guardando…' : 'Guardar subtítulo'}
                            </button>
                            {hasCustom && (
                              <button
                                type="button"
                                className="button button--inline button--secondary"
                                disabled={saving || busy}
                                onClick={() => void clearFragmentCaption(segment)}
                              >
                                Texto del video
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}

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
                        <label className="reel-jump__transition">
                          <span className="visually-hidden">Transición</span>
                          <select
                            value={segment.transition_type}
                            disabled={busy}
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
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
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
            id="reel-tool-panel-audio"
            role="tabpanel"
            aria-labelledby="reel-tool-tab-audio"
            hidden={activeTool !== 'audio'}
          >
            <BackgroundMusicPanel
              projectId={projectId}
              onSettingsChange={(settings) => {
                setBackgroundMusic(settings);
                applyMusicGain(settings);
              }}
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
            />
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
