import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from 'react';

import {
  overlayKindLabel,
  overlaySourceWindow,
  overlayTextLabel,
  type ReelOverlay,
} from '../types/overlay';
import type { ReelSegment, TransitionType } from '../types/reel';
import { formatDuration, formatTimecode } from '../utils/format';
import {
  collectLaneOccupants,
  occupantId,
  parseOccupantId,
  placeOnLane,
  placeTextOverlay,
  resolveExclusiveLane,
  settleExclusiveLanes,
  type Occupant,
} from '../utils/laneOccupancy';
import {
  assignLanes,
  clampLane,
  defaultLaneLayout,
  inheritSegmentLanes,
  insertLane,
  laneForCaption,
  laneForSegment,
  loadLaneLayout,
  MAX_LANES,
  MIN_LANES,
  remapAfterRemove,
  removeLane,
  saveLaneLayout,
  type NleLaneLayout,
} from '../utils/nleLanes';
import { isNleHotkeyTarget, isReelEditorHotkeysActive } from '../utils/nleHotkeys';
import {
  applyNleSelection,
  modifierSelect,
  nleIdsOfKind,
  nleItemSelected,
  type NleItemRef,
} from '../utils/nleSelection';
import {
  buildOutputClock,
  DEFAULT_TRANSITION_MS,
  editTimeFromOutput,
  outputTimeFromEdit,
  transitionMarkerAt,
} from '../utils/reelOutputClock';
import {
  buildClipSpans,
  buildSourceGaps,
  outputTimeFromTrackRatio,
  playheadPercent,
  pxToTime,
  shiftCaptionWindow,
  timeToPx,
} from '../utils/reelTimelineStrip';
import {
  canJoinSourceWindows,
  clipDeleteAction,
  type SourceWindow,
} from '../utils/reelTrim';
import { captionIsOmitted } from '../utils/reelCaptions';
import {
  envelopeDotStyle,
  envelopePolyline,
  interpolateGain,
  normalizeKeyframes,
  peaksPath,
  removeKeyframe,
  seedEndpoints,
  shiftEnvelopeGain,
  slicePeaks,
  upsertKeyframe,
  type VolumeKeyframe,
} from '../utils/volumeEnvelope';
import { TRANSITION_DURATION_MIME, TRANSITION_MIME, TRANSITION_OPTIONS } from './nle/clipConstants';
import { NleContextMenu, type NleMenuItem } from './nle/NleContextMenu';
import { TransitionGlyph } from './nle/TransitionGlyph';

export type TimelineTrackKind = 'video' | 'overlays' | 'captions' | 'music';

const ASSET_MIME = 'application/x-sermon-asset';
const MIN_PX_PER_SECOND = 40;
const MAX_PX_PER_SECOND = 200;
const DEFAULT_PX_PER_SECOND = 80;

interface ReelTimelineStripProps {
  reelId?: string;
  segments: ReelSegment[];
  overlays?: ReelOverlay[];
  /** Program duration after xfade. The strip maps it onto the sequential board. */
  totalDuration: number;
  outputTime: number;
  selectedSegmentId: string | null;
  selectedOverlayId?: string | null;
  selectedGapKey?: string | null;
  captionLabels: Record<string, string>;
  musicActive: boolean;
  musicLabel?: string;
  pxPerSecond?: number;
  onZoomChange?: (pxPerSecond: number) => void;
  onSeek: (outputSeconds: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onSelectSegment: (segmentId: string, track: TimelineTrackKind) => void;
  onSelectGap?: (gapKey: string | null) => void;
  onSelectOverlay?: (overlayId: string) => void;
  onSelectMusic?: () => void;
  onReorderSegments?: (orderedIds: string[]) => void;
  onMoveVideoPad?: (id: string, padBeforeMs: number, persist?: boolean) => void;
  onTrimSegment?: (
    id: string,
    patch: { source_start_seconds?: number; source_end_seconds?: number },
  ) => void;
  onMoveCaption?: (id: string, inMs: number, outMs: number, persist?: boolean) => void;
  onMoveCaptions?: (
    items: { id: string; inMs: number; outMs: number }[],
    persist?: boolean,
  ) => void;
  onApplyTransition?: (segmentId: string, type: TransitionType, durationMs?: number) => void;
  onMoveOverlay?: (id: string, startMs: number) => void;
  onMoveOverlays?: (
    items: { id: string; startMs: number; lane: number }[],
    persist?: boolean,
  ) => void;
  onDropAsset?: (assetId: string, outputSeconds: number, lane?: number) => void;
  onAddTextOverlay?: (outputSeconds: number, lane?: number) => void;
  onSplitAtPlayhead?: (outputSeconds?: number) => void;
  onJoinAtCut?: (segmentId: string) => void;
  onDeleteOverlay?: (overlayId: string) => void;
  onDeleteSegments?: (segmentIds: string[]) => void;
  captionsEnabled?: boolean;
  onDeleteCaptions?: (segmentIds: string[]) => void;
  onRestoreCaptions?: (segmentIds: string[]) => void;
  originWindows?: SourceWindow[];
  onMoveOverlayLane?: (overlayId: string, lane: number) => void;
  videoPeaks?: number[];
  musicPeaks?: number[];
  sourceDuration?: number;
  onVolumeKeyframes?: (segmentId: string, points: VolumeKeyframe[]) => void;
  onMusicVolumeKeyframes?: (points: VolumeKeyframe[]) => void;
  musicKeyframes?: VolumeKeyframe[];
}

const TRANSITION_LABELS: Record<string, string> = Object.fromEntries(
  TRANSITION_OPTIONS.map((option) => [option.value, option.label]),
);

function clampZoom(value: number): number {
  return Math.max(MIN_PX_PER_SECOND, Math.min(MAX_PX_PER_SECOND, Math.round(value)));
}

function timeFromClientX(
  clientX: number,
  element: HTMLElement,
  totalDuration: number,
  pxPerSecond: number,
): number {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || totalDuration <= 0) return 0;
  const localX = clientX - rect.left;
  const fromPx = pxToTime(localX, pxPerSecond);
  // When zoomed wider than the viewport, map by pixels; otherwise by ratio.
  if (element.scrollWidth > rect.width + 1 || timeToPx(totalDuration, pxPerSecond) > rect.width + 1) {
    return Math.max(0, Math.min(totalDuration, fromPx));
  }
  return outputTimeFromTrackRatio(Math.max(0, Math.min(1, localX / rect.width)), totalDuration);
}

function segmentAtOutput(
  spans: ReturnType<typeof buildClipSpans>,
  outputSeconds: number,
): string | null {
  for (const span of spans) {
    if (outputSeconds >= span.start && outputSeconds < span.start + span.duration) {
      return span.id;
    }
  }
  return spans.length > 0 ? spans[spans.length - 1].id : null;
}

export function ReelTimelineStrip({
  reelId,
  segments,
  overlays = [],
  totalDuration,
  outputTime,
  selectedSegmentId,
  selectedOverlayId = null,
  selectedGapKey = null,
  captionLabels,
  musicActive,
  musicLabel = 'Música de fondo',
  pxPerSecond: pxPerSecondProp,
  onZoomChange,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onSelectSegment,
  onSelectGap,
  onSelectOverlay,
  onSelectMusic,
  onReorderSegments,
  onTrimSegment,
  onMoveCaption,
  onMoveCaptions,
  onApplyTransition,
  onMoveOverlay,
  onMoveOverlays,
  onDropAsset,
  onAddTextOverlay,
  onSplitAtPlayhead,
  onJoinAtCut,
  onDeleteOverlay,
  onDeleteSegments,
  captionsEnabled = true,
  onDeleteCaptions,
  onRestoreCaptions,
  originWindows = [],
  onMoveOverlayLane,
  videoPeaks = [],
  musicPeaks = [],
  sourceDuration = 0,
  onVolumeKeyframes,
  onMusicVolumeKeyframes,
  musicKeyframes,
}: ReelTimelineStripProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [localZoom, setLocalZoom] = useState(DEFAULT_PX_PER_SECOND);
  const [dragOver, setDragOver] = useState(false);
  const [transitionDragOverId, setTransitionDragOverId] = useState<string | null>(null);
  const reorderDragIdRef = useRef<string | null>(null);
  const [reorderOverId, setReorderOverId] = useState<string | null>(null);
  const [laneLayout, setLaneLayout] = useState<NleLaneLayout>(() =>
    reelId ? loadLaneLayout(reelId) : defaultLaneLayout(),
  );
  const [menu, setMenu] = useState<{ x: number; y: number; items: NleMenuItem[] } | null>(null);
  const [captionDrafts, setCaptionDrafts] = useState<
    Record<string, { inMs: number; outMs: number; lane: number }>
  >({});
  const [overlayDrafts, setOverlayDrafts] = useState<
    Record<string, { startMs: number; lane: number }>
  >({});
  const [segmentDraft, setSegmentDraft] = useState<{
    ids: string[];
    dx: number;
    dy: number;
    lane: number;
  } | null>(null);
  const [selection, setSelection] = useState<NleItemRef[]>([]);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const laneLayoutRef = useRef(laneLayout);
  laneLayoutRef.current = laneLayout;

  function commitSelection(item: NleItemRef, additive: boolean) {
    const next = applyNleSelection(selectionRef.current, item, additive);
    setSelection(next);
    const primary = next[next.length - 1];
    if (!primary) return;
    if (primary.kind === 'overlay') onSelectOverlay?.(primary.id);
    else if (primary.kind === 'caption') onSelectSegment(primary.id, 'captions');
    else if (primary.kind === 'segment') onSelectSegment(primary.id, 'video');
    else onSelectMusic?.();
  }

  function selectedIds(kind: NleItemRef['kind'], fallbackId: string): string[] {
    const ids = nleIdsOfKind(selectionRef.current, kind);
    if (ids.includes(fallbackId)) return ids;
    return [fallbackId];
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!isReelEditorHotkeysActive() || !isNleHotkeyTarget(event.target)) return;
      const overlayIds = nleIdsOfKind(selectionRef.current, 'overlay');
      const segmentIds = nleIdsOfKind(selectionRef.current, 'segment');
      const captionIds = nleIdsOfKind(selectionRef.current, 'caption');
      if (overlayIds.length === 0 && segmentIds.length === 0 && captionIds.length === 0) return;
      event.preventDefault();
      if (captionIds.length > 0 && onDeleteCaptions) {
        onDeleteCaptions(captionIds);
        setSelection((prev) => prev.filter((item) => item.kind !== 'caption'));
        return;
      }
      if (overlayIds.length > 0 && onDeleteOverlay) {
        overlayIds.forEach((id) => onDeleteOverlay(id));
        setSelection((prev) => prev.filter((item) => item.kind !== 'overlay'));
      }
      if (segmentIds.length > 0 && onDeleteSegments) {
        onDeleteSegments(segmentIds);
        setSelection((prev) => prev.filter((item) => item.kind !== 'segment'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDeleteOverlay, onDeleteSegments, onDeleteCaptions]);

  useEffect(() => {
    if (captionsEnabled) return;
    setSelection((prev) => prev.filter((item) => item.kind !== 'caption'));
  }, [captionsEnabled]);

  const pxPerSecond = clampZoom(pxPerSecondProp ?? localZoom);

  const segmentIdsKey = segments.map((segment) => segment.id).join('|');
  useLayoutEffect(() => {
    if (!reelId) {
      setLaneLayout(defaultLaneLayout());
      return;
    }
    const stored = loadLaneLayout(reelId);
    const orderedIds = segmentIdsKey ? segmentIdsKey.split('|') : [];
    const next = inheritSegmentLanes(stored, orderedIds);
    setLaneLayout(next);
    if (next !== stored) saveLaneLayout(reelId, next);
  }, [reelId, segmentIdsKey]);

  const persistLanes = useCallback(
    (next: NleLaneLayout) => {
      setLaneLayout(next);
      if (reelId) saveLaneLayout(reelId, next);
    },
    [reelId],
  );

  function occupancyMap(excludeIds: string[] = []) {
    const skip = new Set(excludeIds);
    const layoutNow = { ...laneLayoutRef.current, laneCount };
    const clips = spans
      .map((span) => {
        const segment = segments[span.index];
        if (!segment) return null;
        const id = occupantId('segment', segment.id);
        if (skip.has(id)) return null;
        return {
          id: segment.id,
          lane: laneForSegment(layoutNow, segment.id),
          start: span.start,
          end: span.start + span.duration,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item != null);
    const overlayItems = overlays
      .map((overlay) => {
        const id = occupantId(overlay.kind === 'text' ? 'text' : 'overlay', overlay.id);
        if (skip.has(id)) return null;
        const draft = overlayDrafts[overlay.id];
        const start = (draft?.startMs ?? overlay.start_ms) / 1000;
        return {
          id: overlay.id,
          lane: clampLane(draft?.lane ?? overlay.z_index, laneCount),
          start,
          end: start + Math.max(0.2, overlay.duration_ms / 1000),
          asText: overlay.kind === 'text',
        };
      })
      .filter((item): item is NonNullable<typeof item> => item != null);
    const captionItems = captionsEnabled
      ? spans
          .map((span) => {
            const segment = timelineSegments[span.index] ?? segments[span.index];
            if (!segment) return null;
            if (captionIsOmitted(segment) && captionDrafts[segment.id] == null) return null;
            const id = occupantId('caption', segment.id);
            if (skip.has(id)) return null;
            const draft = captionDrafts[segment.id];
            const start =
              draft != null
                ? draft.inMs / 1000
                : segment.caption_in_ms != null
                  ? segment.caption_in_ms / 1000
                  : span.start;
            const end =
              draft != null
                ? draft.outMs / 1000
                : segment.caption_out_ms != null
                  ? segment.caption_out_ms / 1000
                  : span.start + span.duration;
            return {
              id: segment.id,
              lane: draft?.lane ?? laneForCaption(layoutNow, segment.id),
              start,
              end: Math.max(start + 0.2, end),
            };
          })
          .filter((item): item is NonNullable<typeof item> => item != null)
      : [];
    return collectLaneOccupants({
      laneCount,
      clips,
      captions: captionItems,
      overlays: overlayItems,
      musicLane:
        musicActive && !skip.has(occupantId('music', 'music'))
          ? clampLane(layoutNow.musicLane, laneCount)
          : null,
      musicEnd: editDuration,
    });
  }

  function exclusiveLaneFor(candidate: Occupant, preferred: number, excludeIds: string[]) {
    return resolveExclusiveLane(occupancyMap(excludeIds), candidate, laneCount, preferred);
  }

  const laneCount = useMemo(() => {
    const fromOverlays = overlays.reduce((max, overlay) => Math.max(max, overlay.z_index + 1), 0);
    const fromCaptions = Math.max(0, ...Object.values(laneLayout.captionLanes).map((lane) => lane + 1));
    const fromSegments = Math.max(0, ...Object.values(laneLayout.segmentLanes).map((lane) => lane + 1));
    return Math.min(
      MAX_LANES,
      Math.max(laneLayout.laneCount, fromOverlays, fromCaptions, fromSegments, 2),
    );
  }, [laneLayout.captionLanes, laneLayout.laneCount, laneLayout.segmentLanes, overlays]);
  const layoutWithCount = { ...laneLayout, laneCount };

  function setZoom(next: number) {
    const clamped = clampZoom(next);
    if (onZoomChange) onZoomChange(clamped);
    else setLocalZoom(clamped);
  }

  const timelineSegments = segments;
  const clock = useMemo(() => buildOutputClock(timelineSegments), [timelineSegments]);
  const editDuration = clock.editDuration > 0 ? clock.editDuration : totalDuration;
  const spans = useMemo(() => buildClipSpans(timelineSegments), [timelineSegments]);
  const boardDuration = useMemo(() => {
    let max = editDuration;
    spans.forEach((span) => {
      max = Math.max(max, span.start + span.duration);
    });
    overlays.forEach((overlay) => {
      const draft = overlayDrafts[overlay.id];
      const start = (draft?.startMs ?? overlay.start_ms) / 1000;
      max = Math.max(max, start + Math.max(0.2, overlay.duration_ms / 1000));
    });
    if (captionsEnabled) {
      spans.forEach((span) => {
        const segment = timelineSegments[span.index];
        if (!segment) return;
        const draft = captionDrafts[segment.id];
        const end =
          draft != null
            ? draft.outMs / 1000
            : segment.caption_out_ms != null
              ? segment.caption_out_ms / 1000
              : span.start + span.duration;
        max = Math.max(max, end);
      });
    }
    return max;
  }, [captionDrafts, captionsEnabled, editDuration, overlayDrafts, overlays, spans, timelineSegments]);
  const settleKeyRef = useRef('');
  useEffect(() => {
    if (segmentDraft) return;
    if (Object.keys(overlayDrafts).length > 0 || Object.keys(captionDrafts).length > 0) return;
    const settled = settleExclusiveLanes(occupancyMap(), laneCount);
    const overlayMoves: { id: string; startMs: number; lane: number }[] = [];
    const captionMoves: { id: string; inMs: number; outMs: number }[] = [];
    const nextCaptionLanes = { ...laneLayout.captionLanes };
    let captionLanesChanged = false;
    for (const [key, lane] of settled.assignments) {
      const parsed = parseOccupantId(key);
      const time = settled.times.get(key);
      if (!parsed || !time) continue;
      if (parsed.kind === 'overlay' || parsed.kind === 'text') {
        const overlay = overlays.find((item) => item.id === parsed.rawId);
        if (!overlay) continue;
        const startMs = Math.round(time.start * 1000);
        if (
          overlay.start_ms !== startMs ||
          clampLane(overlay.z_index, laneCount) !== lane
        ) {
          overlayMoves.push({ id: overlay.id, startMs, lane });
        }
      }
      if (parsed.kind === 'caption' && captionsEnabled) {
        const segment = segments.find((item) => item.id === parsed.rawId);
        const span = spans.find((item) => item.id === parsed.rawId);
        if (!segment) continue;
        const inMs = Math.round(time.start * 1000);
        const outMs = Math.round(time.end * 1000);
        const currentIn =
          segment.caption_in_ms ?? Math.round((span?.start ?? 0) * 1000);
        const currentOut =
          segment.caption_out_ms ??
          Math.round(((span?.start ?? 0) + (span?.duration ?? 0)) * 1000);
        if (Math.abs(currentIn - inMs) > 30 || Math.abs(currentOut - outMs) > 30) {
          captionMoves.push({ id: segment.id, inMs, outMs });
        }
        if (laneForCaption({ ...laneLayout, laneCount }, segment.id) !== lane) {
          nextCaptionLanes[segment.id] = lane;
          captionLanesChanged = true;
        }
      }
    }
    if (overlayMoves.length === 0 && captionMoves.length === 0 && !captionLanesChanged) {
      return;
    }
    const token = JSON.stringify({
      overlayMoves,
      captionMoves,
      nextCaptionLanes,
      lanes: settled.laneCount,
    });
    if (settleKeyRef.current === token) return;
    settleKeyRef.current = token;
    if (captionLanesChanged || settled.laneCount !== laneCount) {
      persistLanes({
        ...laneLayout,
        laneCount: Math.max(laneCount, settled.laneCount),
        captionLanes: nextCaptionLanes,
      });
    }
    if (overlayMoves.length > 0) onMoveOverlays?.(overlayMoves, true);
    if (captionMoves.length > 0) {
      if (onMoveCaptions) onMoveCaptions(captionMoves, true);
      else {
        captionMoves.forEach((entry) =>
          onMoveCaption?.(entry.id, entry.inMs, entry.outMs, true),
        );
      }
    }
  }, [
    captionDrafts,
    captionsEnabled,
    laneCount,
    laneLayout,
    onMoveCaption,
    onMoveCaptions,
    onMoveOverlays,
    overlayDrafts,
    overlays,
    persistLanes,
    segmentDraft,
    segments,
    spans,
  ]);
  const spansRef = useRef(spans);
  spansRef.current = spans;
  const sourceGaps = useMemo(() => buildSourceGaps(segments), [segments]);
  const markers = useMemo(
    () => transitionMarkerAt(clock, timelineSegments),
    [clock, timelineSegments],
  );
  const timelineWidthPx = Math.max(timeToPx(boardDuration, pxPerSecond), 1);
  const playheadEdit = editTimeFromOutput(clock, outputTime);
  const playhead = playheadPercent(playheadEdit, boardDuration);

  function syncRulerScroll() {
    const scroller = scrollRef.current;
    const ruler = rulerScrollRef.current;
    if (!scroller || !ruler) return;
    if (ruler.scrollLeft !== scroller.scrollLeft) ruler.scrollLeft = scroller.scrollLeft;
  }

  useEffect(() => {
    if (scrubbingRef.current) return;
    const scroller = scrollRef.current;
    if (!scroller || boardDuration <= 0) return;
    const x = timeToPx(playheadEdit, pxPerSecond);
    const left = scroller.scrollLeft;
    const width = scroller.clientWidth;
    const margin = 36;
    if (x < left + margin) {
      scroller.scrollLeft = Math.max(0, x - margin);
    } else if (x > left + width - margin) {
      scroller.scrollLeft = Math.max(0, x + margin - width);
    }
    syncRulerScroll();
  }, [boardDuration, playheadEdit, pxPerSecond]);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const track = board.querySelector<HTMLElement>('.reel-nle__track--aroll');
    if (!track) return;
    const boardRect = board.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const pad = 8;
    if (trackRect.top < boardRect.top + pad) {
      board.scrollTop += trackRect.top - boardRect.top - pad;
    } else if (trackRect.bottom > boardRect.bottom - pad) {
      board.scrollTop += trackRect.bottom - boardRect.bottom + pad;
    }
  }, [reelId]);

  function editTimeAtClientX(clientX: number): number | null {
    const surface = surfaceRef.current;
    if (!surface || boardDuration <= 0) return null;
    return timeFromClientX(clientX, surface, boardDuration, pxPerSecond);
  }

  function seekToClientX(clientX: number) {
    const editTime = editTimeAtClientX(clientX);
    if (editTime == null) return null;
    onSeek(outputTimeFromEdit(clock, editTime));
    return editTime;
  }

  function beginScrub(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.reel-nle__clip')) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    event.preventDefault();
    scrubbingRef.current = true;
    setDragging(true);
    onScrubStart?.();
    surface.setPointerCapture(event.pointerId);
    const output = seekToClientX(event.clientX);
    if (output != null) {
      const id = segmentAtOutput(spans, output);
      if (id) onSelectSegment(id, 'video');
    }
  }

  function moveScrub(event: PointerEvent<HTMLElement>) {
    if (!scrubbingRef.current) return;
    seekToClientX(event.clientX);
  }

  function endScrub(event: PointerEvent<HTMLElement>) {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setDragging(false);
    try {
      surfaceRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    seekToClientX(event.clientX);
    onScrubEnd?.();
  }

  function beginTrim(
    event: PointerEvent<HTMLElement>,
    segment: ReelSegment,
    edge: 'start' | 'end',
  ) {
    if (event.button !== 0 || !onTrimSegment) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startSourceStart = segment.source_start_seconds;
    const startSourceEnd = segment.source_end_seconds;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaSec = pxToTime(moveEvent.clientX - startX, pxPerSecond);
      if (edge === 'start') {
        onTrimSegment(segment.id, {
          source_start_seconds: round3(startSourceStart + deltaSec),
        });
      } else {
        onTrimSegment(segment.id, {
          source_end_seconds: round3(startSourceEnd + deltaSec),
        });
      }
    };

    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // already released
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function beginOverlayDrag(event: PointerEvent<HTMLElement>, overlay: ReelOverlay) {
    if (event.button !== 0 || !(onMoveOverlays || onMoveOverlay)) return;
    event.preventDefault();
    event.stopPropagation();
    const item: NleItemRef = { kind: 'overlay', id: overlay.id };
    if (!nleItemSelected(selectionRef.current, item) || !modifierSelect(event)) {
      commitSelection(item, modifierSelect(event));
    } else {
      onSelectOverlay?.(overlay.id);
    }
    const groupIds = selectedIds('overlay', overlay.id);
    const origins = overlays
      .filter((entry) => groupIds.includes(entry.id))
      .map((entry) => ({
        id: entry.id,
        startMs: entry.start_ms,
        lane: clampLane(entry.z_index, laneCount),
      }));
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // already captured
    }
    let last = origins;

    const apply = (clientX: number, clientY: number) => {
      autoScrollBoard(clientY);
      const deltaMs = Math.round(pxToTime(clientX - startX, pxPerSecond) * 1000);
      const hover = laneFromClientY(clientY);
      const dropLane = Math.abs(clientY - startY) > 10 && hover != null ? hover : null;
      last = origins.map((origin) => ({
        ...origin,
        startMs: Math.max(0, origin.startMs + deltaMs),
        lane: dropLane != null ? dropLane : origin.lane,
      }));
      setOverlayDrafts(Object.fromEntries(last.map((entry) => [entry.id, entry])));
    };

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      apply(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      apply(upEvent.clientX, upEvent.clientY);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // already released
      }
      const exclude = last.map((entry) => {
        const overlay = overlays.find((item) => item.id === entry.id);
        return occupantId(overlay?.kind === 'text' ? 'text' : 'overlay', entry.id);
      });
      const byLane = occupancyMap(exclude);
      last = last.map((entry) => {
        const overlay = overlays.find((item) => item.id === entry.id);
        const duration = Math.max(0.2, (overlay?.duration_ms ?? 3000) / 1000);
        const asText = overlay?.kind === 'text';
        const candidate: Occupant = {
          id: occupantId(asText ? 'text' : 'overlay', entry.id),
          kind: asText ? 'text' : 'overlay',
          start: entry.startMs / 1000,
          end: entry.startMs / 1000 + duration,
        };
        if (asText) {
          const packed = placeTextOverlay(byLane, candidate, laneCount, entry.lane);
          byLane.set(packed.lane, [...(byLane.get(packed.lane) ?? []), packed.occupant]);
          return {
            ...entry,
            startMs: Math.round(packed.occupant.start * 1000),
            lane: packed.lane,
          };
        }
        const fitted = placeOnLane(byLane.get(entry.lane) ?? [], candidate);
        byLane.set(entry.lane, [...(byLane.get(entry.lane) ?? []), fitted]);
        return { ...entry, startMs: Math.round(fitted.start * 1000) };
      });
      if (onMoveOverlays) onMoveOverlays(last, true);
      else {
        last.forEach((entry) => {
          onMoveOverlay?.(entry.id, entry.startMs);
          if (entry.lane !== origins.find((origin) => origin.id === entry.id)?.lane) {
            onMoveOverlayLane?.(entry.id, entry.lane);
          }
        });
      }
      setOverlayDrafts({});
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
    const onCancel = (cancelEvent: globalThis.PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // already released
      }
      setOverlayDrafts({});
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
  }

  function beginSegmentDrag(event: PointerEvent<HTMLElement>, segment: ReelSegment) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const item: NleItemRef = { kind: 'segment', id: segment.id };
    const groupIds = selectedIds('segment', segment.id);
    const originLane = laneForSegment(layoutWithCount, segment.id);
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startX = event.clientX;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // already captured
    }
    let lastLane = originLane;
    let finished = false;
    let moved = false;

    const applyPointer = (clientX: number, clientY: number) => {
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) moved = true;
      const hover = laneFromClientY(clientY);
      if (hover != null) lastLane = hover;
      const changingLane =
        lastLane != null &&
        lastLane !== originLane &&
        Math.abs(dy) > 24 &&
        Math.abs(dy) >= Math.abs(dx) * 0.4;
      if (!changingLane) return;
      autoScrollBoard(clientY);
      setSegmentDraft({
        ids: groupIds,
        dx: 0,
        dy,
        lane: lastLane,
      });
    };

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      applyPointer(moveEvent.clientX, moveEvent.clientY);
    };
    const finish = (clientX: number, clientY: number, commit: boolean) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // already released
      }
      if (!commit) {
        setSegmentDraft(null);
        return;
      }
      applyPointer(clientX, clientY);
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (!moved) {
        if (!nleItemSelected(selectionRef.current, item) || !modifierSelect(event)) {
          commitSelection(item, modifierSelect(event));
        } else {
          onSelectSegment(segment.id, 'video');
        }
        setSegmentDraft(null);
        return;
      }
      const changingLane =
        lastLane != null &&
        lastLane !== originLane &&
        Math.abs(dy) > 24 &&
        Math.abs(dy) >= Math.abs(dx) * 0.4;
      if (changingLane && lastLane != null) {
        persistLanes(
          assignLanes({ ...laneLayoutRef.current, laneCount }, groupIds, lastLane, 'segmentLanes'),
        );
      }
      setSegmentDraft(null);
    };
    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      finish(upEvent.clientX, upEvent.clientY, true);
    };
    const onCancel = (cancelEvent: globalThis.PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      finish(cancelEvent.clientX, cancelEvent.clientY, false);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
  }

  function beginCaptionDrag(
    event: PointerEvent<HTMLElement | HTMLSpanElement>,
    segment: ReelSegment,
    spanStart: number,
    spanDuration: number,
    edge: 'move' | 'start' | 'end',
  ) {
    if (event.button !== 0 || !onMoveCaption) return;
    event.preventDefault();
    event.stopPropagation();
    const item: NleItemRef = { kind: 'caption', id: segment.id };
    if (!nleItemSelected(selectionRef.current, item) || !modifierSelect(event)) {
      commitSelection(item, modifierSelect(event));
    } else {
      onSelectSegment(segment.id, 'captions');
    }
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // already captured or not a capturing target
    }
    const layoutNow = { ...laneLayoutRef.current, laneCount };
    const groupIds = edge === 'move' ? selectedIds('caption', segment.id) : [segment.id];
    const origins = groupIds.map((id) => {
      const span = spans.find((entry) => entry.id === id);
      const entry = timelineSegments.find((item) => item.id === id);
      const start = span?.start ?? spanStart;
      const duration = span?.duration ?? spanDuration;
      return {
        id,
        inMs: entry?.caption_in_ms ?? Math.round(start * 1000),
        outMs: entry?.caption_out_ms ?? Math.round((start + duration) * 1000),
        lane: laneForCaption(layoutNow, id),
      };
    });
    const totalMs = Math.max(200, totalDuration * 1000);
    let last: Array<{ id: string; inMs: number; outMs: number; lane: number; dropLane: number }> =
      origins.map((origin) => ({ ...origin, dropLane: origin.lane }));

    const apply = (clientX: number, clientY: number) => {
      autoScrollBoard(clientY);
      const deltaMs = Math.round(pxToTime(clientX - startX, pxPerSecond) * 1000);
      const hover = laneFromClientY(clientY);
      const dropLane = Math.abs(clientY - startY) > 10 && hover != null ? hover : null;
      last = origins.map((origin) => ({
        ...shiftCaptionWindow(origin.inMs, origin.outMs, deltaMs, edge, totalMs),
        id: origin.id,
        // Keep the origin lane in the DOM while dragging so pointer capture
        // is not lost when the clip remounts on another track.
        lane: origin.lane,
        dropLane: dropLane != null ? dropLane : origin.lane,
      }));
      setCaptionDrafts(
        Object.fromEntries(
          last.map((entry) => [
            entry.id,
            { inMs: entry.inMs, outMs: entry.outMs, lane: entry.lane },
          ]),
        ),
      );
    };

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      apply(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      apply(upEvent.clientX, upEvent.clientY);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // already released
      }
      const layout = laneLayoutRef.current;
      const nextLanes = { ...layout.captionLanes };
      let lanesChanged = false;
      const exclude = last.map((entry) => occupantId('caption', entry.id));
      const byLane = occupancyMap(exclude);
      last.forEach((entry, index) => {
        const nextLane = clampLane(entry.dropLane ?? entry.lane, laneCount);
        const width = Math.max(0.2, (entry.outMs - entry.inMs) / 1000);
        const fitted = placeOnLane(byLane.get(nextLane) ?? [], {
          id: occupantId('caption', entry.id),
          kind: 'caption',
          start: entry.inMs / 1000,
          end: entry.inMs / 1000 + width,
        });
        byLane.set(nextLane, [...(byLane.get(nextLane) ?? []), fitted]);
        entry.lane = nextLane;
        entry.inMs = Math.round(fitted.start * 1000);
        entry.outMs = Math.round(fitted.end * 1000);
        if (nextLane !== origins[index]?.lane) {
          nextLanes[entry.id] = nextLane;
          lanesChanged = true;
        }
      });
      if (lanesChanged) {
        persistLanes({
          ...layout,
          laneCount,
          captionLanes: nextLanes,
        });
      }
      const timesChanged = last.some((entry, index) => {
        const origin = origins[index];
        return !origin || entry.inMs !== origin.inMs || entry.outMs !== origin.outMs;
      });
      const needsPersist = origins.some((origin) => {
        const entry = timelineSegments.find((item) => item.id === origin.id);
        return entry != null && (entry.caption_in_ms == null || entry.caption_out_ms == null);
      });
      if (timesChanged || needsPersist) {
        const payload = timesChanged ? last : origins;
        if (onMoveCaptions) onMoveCaptions(payload, true);
        else payload.forEach((entry) => onMoveCaption(entry.id, entry.inMs, entry.outMs, true));
      }
      setCaptionDrafts({});
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };
    const onCancel = (cancelEvent: globalThis.PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // already released
      }
      setCaptionDrafts({});
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    apply(event.clientX, event.clientY);
  }

  function beginVolumeDrag(
    event: PointerEvent<HTMLElement>,
    durationMs: number,
    current: VolumeKeyframe[],
    onChange: (points: VolumeKeyframe[]) => void,
    boundsEl?: HTMLElement | null,
    existingTMs?: number,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    const bounds = boundsEl ?? target;
    let points = normalizeKeyframes(current);
    const rect0 = bounds.getBoundingClientRect();
    const startT =
      existingTMs ??
      Math.max(
        0,
        Math.min(durationMs, ((event.clientX - rect0.left) / Math.max(1, rect0.width)) * durationMs),
      );
    const startGain = Math.max(
      0,
      Math.min(1, 1 - (event.clientY - rect0.top) / Math.max(1, rect0.height)),
    );
    if (existingTMs == null) {
      points = upsertKeyframe(points, startT, startGain, 120);
    }
    let live = points.find((point) => Math.abs(point.t_ms - startT) <= 120) ?? points[0];
    onChange(points);

    const apply = (clientX: number, clientY: number) => {
      const rect = bounds.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const tMs = Math.max(0, Math.min(durationMs, ((clientX - rect.left) / rect.width) * durationMs));
      const gain = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      const next = { t_ms: tMs, gain };
      points = points
        .map((point) => (point === live ? next : point))
        .sort((a, b) => a.t_ms - b.t_ms);
      live = next;
      onChange(points);
    };

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      apply(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function beginEnvelopeLevelDrag(
    event: PointerEvent<HTMLElement>,
    current: VolumeKeyframe[],
    onChange: (points: VolumeKeyframe[]) => void,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // already captured
    }
    const origin = normalizeKeyframes(current);
    const startY = event.clientY;
    const height = Math.max(1, target.getBoundingClientRect().height);

    const apply = (clientY: number) => {
      onChange(shiftEnvelopeGain(origin, (startY - clientY) / height));
    };

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      apply(moveEvent.clientY);
    };
    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }

  function acceptTransitionDrop(event: DragEvent, segmentId: string) {
    const type = event.dataTransfer.getData(TRANSITION_MIME) as TransitionType;
    if (!type || !onApplyTransition) return;
    event.preventDefault();
    event.stopPropagation();
    const rawMs = Number(event.dataTransfer.getData(TRANSITION_DURATION_MIME));
    onApplyTransition(segmentId, type, Number.isFinite(rawMs) && rawMs > 0 ? rawMs : undefined);
  }

  function handleSurfaceDrop(event: DragEvent<HTMLElement>, lane?: number) {
    event.preventDefault();
    setDragOver(false);
    const assetId = event.dataTransfer.getData(ASSET_MIME);
    if (!assetId || !onDropAsset || !surfaceRef.current) return;
    const editTime = editTimeAtClientX(event.clientX);
    if (editTime == null) return;
    onDropAsset(assetId, outputTimeFromEdit(clock, editTime), lane);
  }

  function closeMenu() {
    setMenu(null);
  }

  function handleRemoveLane(lane: number) {
    if (laneCount <= MIN_LANES) return;
    persistLanes(removeLane({ ...laneLayoutRef.current, laneCount }, lane));
    if (!onMoveOverlays || overlays.length === 0) return;
    const items = overlays
      .map((overlay) => ({
        id: overlay.id,
        startMs: overlay.start_ms,
        lane: remapAfterRemove(overlay.z_index, lane),
      }))
      .filter((item, index) => item.lane !== overlays[index].z_index);
    if (items.length > 0) onMoveOverlays(items);
  }

  function laneMenuExtras(lane: number, clientX: number): NleMenuItem[] {
    return [
      {
        id: 'add-text',
        label: 'Añadir texto aquí',
        disabled: !onAddTextOverlay,
        onSelect: () => {
          const editTime = editTimeAtClientX(clientX);
          if (editTime == null) return;
          onAddTextOverlay?.(outputTimeFromEdit(clock, editTime), lane);
        },
      },
      {
        id: 'del-lane',
        label: laneCount <= MIN_LANES ? 'Eliminar franja (mínimo 2)' : 'Eliminar franja',
        danger: true,
        disabled: laneCount <= MIN_LANES,
        onSelect: () => handleRemoveLane(lane),
      },
    ];
  }

  function joinNear(outputSeconds: number): string | null {
    for (let index = 0; index < spans.length - 1; index += 1) {
      const visualEnd = spans[index].start + spans[index].duration;
      const nextStart = spans[index + 1].start;
      if (
        Math.abs(outputSeconds - nextStart) <= 0.75 ||
        Math.abs(outputSeconds - visualEnd) <= 0.75
      ) {
        return spans[index].id;
      }
    }
    return null;
  }

  function laneFromClientY(clientY: number): number | null {
    const root = boardRef.current ?? scrollRef.current;
    const tracks = root?.querySelectorAll<HTMLElement>('[data-lane]');
    if (!tracks || tracks.length === 0) return null;
    for (const track of tracks) {
      const rect = track.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const lane = Number(track.dataset.lane);
        return Number.isFinite(lane) ? clampLane(lane, laneCount) : null;
      }
    }
    return null;
  }

  function autoScrollBoard(clientY: number) {
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const margin = 32;
    if (clientY < rect.top + margin) board.scrollTop -= 18;
    else if (clientY > rect.bottom - margin) board.scrollTop += 18;
  }

  function openCaptionMenu(event: ReactMouseEvent, segmentId: string) {
    event.preventDefault();
    event.stopPropagation();
    const ids = selectedIds('caption', segmentId);
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: 'del-cap',
          label: ids.length > 1 ? 'Eliminar subtítulos seleccionados' : 'Eliminar este subtítulo',
          danger: true,
          disabled: !onDeleteCaptions,
          onSelect: () => onDeleteCaptions?.(ids),
        },
      ],
    });
  }

  function openTimelineMenu(event: ReactMouseEvent, extras: NleMenuItem[] = []) {
    event.preventDefault();
    event.stopPropagation();
    const editTime = editTimeAtClientX(event.clientX) ?? playheadEdit;
    const output = outputTimeFromEdit(clock, editTime);
    onSeek(output);
    const clipId = segmentAtOutput(spans, editTime);
    const leftJoinId = joinNear(editTime);
    const leftIndex = leftJoinId ? spans.findIndex((span) => span.id === leftJoinId) : -1;
    const leftSegment = leftJoinId ? segments.find((item) => item.id === leftJoinId) : null;
    const rightSegment =
      leftIndex >= 0
        ? segments.find((item) => item.id === spans[leftIndex + 1]?.id)
        : null;
    const canJoin =
      onJoinAtCut != null &&
      leftSegment != null &&
      rightSegment != null &&
      canJoinSourceWindows(leftSegment.source_end_seconds, rightSegment.source_start_seconds);
    const items: NleMenuItem[] = [
      {
        id: 'split',
        label: 'Cortar aquí',
        disabled: !onSplitAtPlayhead || !clipId,
        onSelect: () => onSplitAtPlayhead?.(output),
      },
      {
        id: 'join',
        label: 'Unir corte',
        disabled: !canJoin,
        onSelect: () => {
          if (leftJoinId) onJoinAtCut?.(leftJoinId);
        },
      },
      ...extras,
    ];
    const clickLane = laneFromClientY(event.clientY);
    const clipOnLane =
      clipId != null &&
      clickLane != null &&
      laneForSegment({ ...laneLayoutRef.current, laneCount }, clipId) === clickLane;
    if (clipOnLane && onRestoreCaptions) {
      const clip = segments.find((item) => item.id === clipId);
      if (clip && captionIsOmitted(clip)) {
        items.push({
          id: 'restore-cap',
          label: 'Cargar subtítulo de este fragmento',
          onSelect: () => onRestoreCaptions([clipId]),
        });
      }
    }
    if (clipOnLane && onDeleteSegments) {
      const ids = selectedIds('segment', clipId);
      const actions = ids.map((id) => clipDeleteAction(segments, id, originWindows));
      const canAct = actions.some((action) => action !== 'keep');
      const allJoin = actions.length > 0 && actions.every((action) => action === 'join');
      const allRemove = actions.length > 0 && actions.every((action) => action === 'remove');
      items.push({
        id: 'del-clip',
        label: allJoin
          ? ids.length > 1
            ? `Eliminar ${ids.length} cortes`
            : 'Eliminar corte'
          : allRemove
            ? ids.length > 1
              ? `Eliminar ${ids.length}`
              : 'Eliminar fragmento'
            : canAct
              ? 'Eliminar'
              : 'El fragmento elegido no se puede eliminar',
        danger: true,
        disabled: !canAct,
        onSelect: () => onDeleteSegments(ids),
      });
    }
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  function handleClipDragOver(event: DragEvent<HTMLElement>, segmentId: string) {
    if (!reorderDragIdRef.current || reorderDragIdRef.current === segmentId) return;
    event.preventDefault();
    setReorderOverId(segmentId);
  }

  function handleClipDrop(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    event.stopPropagation();
    const dragId = reorderDragIdRef.current;
    setReorderOverId(null);
    reorderDragIdRef.current = null;
    if (!dragId || !onReorderSegments || dragId === targetId) return;
    const ids = segments.map((segment) => segment.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    onReorderSegments(next);
  }

  if (segments.length === 0 || editDuration <= 0) {
    return (
      <div className="reel-nle__strip reel-nle__strip--empty" aria-label="Línea temporal del Reel">
        <p className="muted">Añade fragmentos para ver la línea temporal.</p>
        {onAddTextOverlay && (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onAddTextOverlay(0)}
          >
            Añadir texto
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`reel-nle__strip${dragging ? ' reel-nle__strip--dragging' : ''}${
        dragOver ? ' reel-nle__strip--drag-over' : ''
      }`}
      aria-label="Línea temporal del Reel"
    >
      <div className="reel-nle__strip-chrome">
        <div className="reel-nle__zoom" role="group" aria-label="Tamaño de la línea temporal">
          <button
            type="button"
            className="reel-nle__zoom-btn"
            title="Más pequeña"
            aria-label="Hacer la línea temporal más pequeña"
            disabled={pxPerSecond <= MIN_PX_PER_SECOND}
            onClick={() => setZoom(pxPerSecond - 20)}
          >
            −
          </button>
          <button
            type="button"
            className="reel-nle__zoom-btn"
            title="Más grande"
            aria-label="Hacer la línea temporal más grande"
            disabled={pxPerSecond >= MAX_PX_PER_SECOND}
            onClick={() => setZoom(pxPerSecond + 20)}
          >
            +
          </button>
        </div>
        <div
          ref={rulerScrollRef}
          className="reel-nle__ruler-scroll"
          onScroll={() => {
            const scroller = scrollRef.current;
            const ruler = rulerScrollRef.current;
            if (scroller && ruler && scroller.scrollLeft !== ruler.scrollLeft) {
              scroller.scrollLeft = ruler.scrollLeft;
            }
          }}
          onPointerDown={beginScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
        >
          <div
            className="reel-nle__ruler"
            style={{ width: `${timelineWidthPx}px`, minWidth: '100%' }}
          >
            <div className="reel-nle__ruler-marks" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((mark) => (
                <span
                  key={mark}
                  className="reel-nle__ruler-mark"
                  style={{ left: `${mark * 100}%` }}
                >
                  {formatDuration(boardDuration * mark)}
                </span>
              ))}
            </div>
            <button
              type="button"
              className={`reel-nle__playhead reel-nle__playhead--needle${
                playhead > 82 ? ' reel-nle__playhead--needle-end' : ''
              }`}
              style={{ left: `${playhead}%` }}
              aria-label="Cursor de reproducción"
              title="Arrastra para mover la posición"
              onPointerDown={(event) => {
                event.stopPropagation();
                beginScrub(event);
              }}
            >
              <span className="reel-nle__playhead-head" />
              <span className="reel-nle__playhead-time">{formatDuration(playheadEdit)}</span>
            </button>
          </div>
        </div>
      </div>
      <div ref={boardRef} className="reel-nle__board">
        <button
          type="button"
          className="reel-nle__add-lane reel-nle__add-lane--above"
          title="Añadir franja arriba"
          aria-label="Añadir franja arriba"
          onClick={() => persistLanes(insertLane({ ...laneLayoutRef.current, laneCount }, laneCount))}
        >
          +
        </button>
        <div className="reel-nle__label-col" aria-hidden="true">
          {Array.from({ length: laneCount }, (_, i) => laneCount - 1 - i).map((lane) => {
            const hasVideo = segments.some((seg) => laneForSegment(layoutWithCount, seg.id) === lane);
            const dropHover = segmentDraft != null && segmentDraft.lane === lane;
            const isAroll = hasVideo || dropHover;
            return (
              <span
                key={`lbl-${lane}`}
                className={`reel-nle__track-label${isAroll ? ' reel-nle__track-label--aroll' : ' reel-nle__track-label--free'}`}
                title={isAroll ? 'Video · arrástralo a otra franja' : `Franja ${lane + 1}`}
              >
                {lane + 1}
              </span>
            );
          })}
        </div>

        <div ref={scrollRef} className="reel-nle__scroll" onScroll={syncRulerScroll}>
          <div
            ref={surfaceRef}
            className="reel-nle__tracks"
            style={{ width: `${timelineWidthPx}px`, minWidth: '100%' }}
            onPointerDown={beginScrub}
            onPointerMove={moveScrub}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            onDragOver={(event) => {
              if (![...event.dataTransfer.types].includes(ASSET_MIME)) return;
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => handleSurfaceDrop(event)}
            onContextMenu={(event) => openTimelineMenu(event)}
          >
            <div
              className="reel-nle__playhead reel-nle__playhead--line"
              style={{ left: `${playhead}%` }}
              aria-hidden="true"
            >
              <span className="reel-nle__playhead-line" />
            </div>

            {Array.from({ length: laneCount }, (_, i) => laneCount - 1 - i).map((lane) => {
              const laneOverlays = overlays.filter((overlay) => {
                const z = overlayDrafts[overlay.id]?.lane ?? overlay.z_index;
                return clampLane(z, laneCount) === lane;
              });
              const laneCaptions = captionsEnabled
                ? spans.filter((span) => {
                    const segment = timelineSegments[span.index];
                    if (!segment) return false;
                    const draft = captionDrafts[segment.id];
                    if (captionIsOmitted(segment) && draft == null) return false;
                    if (draft) return draft.lane === lane;
                    return laneForCaption(layoutWithCount, segment.id) === lane;
                  })
                : [];
              const laneVideos = spans.filter((span) => {
                const segment = timelineSegments[span.index];
                return Boolean(
                  segment && laneForSegment(layoutWithCount, segment.id) === lane,
                );
              });
              const showMusic = musicActive && clampLane(laneLayout.musicLane, laneCount) === lane;
              const dropHover = segmentDraft != null && segmentDraft.lane === lane;
              const hasVideo = laneVideos.length > 0 || dropHover;
              return (
                <div
                  key={`lane-${lane}`}
                  data-lane={lane}
                  className={`reel-nle__track${hasVideo ? ' reel-nle__track--aroll' : ' reel-nle__track--free'}${
                    dropHover ? ' reel-nle__track--drop' : ''
                  }`}
                  aria-label={`Franja ${lane + 1}`}
                  onDoubleClick={(event) => {
                    if (!onAddTextOverlay) return;
                    event.stopPropagation();
                    const editTime = editTimeAtClientX(event.clientX);
                    if (editTime == null) return;
                    onAddTextOverlay(outputTimeFromEdit(clock, editTime), lane);
                  }}
                  onDragOver={(event) => {
                    if (![...event.dataTransfer.types].includes(ASSET_MIME)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setDragOver(true);
                  }}
                  onDrop={(event) => {
                    event.stopPropagation();
                    handleSurfaceDrop(event, lane);
                  }}
                  onContextMenu={(event) =>
                    openTimelineMenu(event, laneMenuExtras(lane, event.clientX))
                  }
                >
                  {laneVideos.map((span) => {
                    const segment = timelineSegments[span.index];
                    if (!segment) return null;
                    const selected =
                      nleItemSelected(selection, { kind: 'segment', id: segment.id }) ||
                      (segment.id === selectedSegmentId &&
                        !nleItemSelected(selection, { kind: 'caption', id: segment.id }));
                    const dragging = Boolean(segmentDraft?.ids.includes(segment.id));
                    const visualSpan = span;
                    const clipPeaks =
                      sourceDuration > 0
                        ? slicePeaks(
                            videoPeaks,
                            segment.source_start_seconds / sourceDuration,
                            segment.source_end_seconds / sourceDuration,
                          )
                        : [];
                    const durationMs = Math.max(200, span.duration * 1000);
                    const keys = seedEndpoints(segment.volume_keyframes, durationMs);
                    return (
                      <div
                        key={span.id}
                        role="button"
                        aria-label={`Fragmento ${span.index + 1}`}
                        className={`reel-nle__clip reel-nle__clip--aroll${span.index % 2 === 1 ? ' reel-nle__clip--alt' : ''}${
                          selected ? ' reel-nle__clip--selected' : ''
                        }${dragging ? ' reel-nle__clip--dragging' : ''}${
                          reorderOverId === segment.id ? ' reel-nle__clip--drop-target' : ''
                        }`}
                        style={{
                          left: `${boardDuration > 0 ? (visualSpan.start / boardDuration) * 100 : 0}%`,
                          width: `${
                            boardDuration > 0
                              ? Math.max((visualSpan.duration / boardDuration) * 100, 0.8)
                              : 0.8
                          }%`,
                          transform: dragging && segmentDraft
                            ? `translate(0px, ${segmentDraft.dy}px)`
                            : undefined,
                          zIndex: dragging ? 20 : 2,
                          willChange: dragging ? 'transform' : undefined,
                        }}
                        title={`Fragmento ${span.index + 1} · ${formatTimecode(segment.source_start_seconds)}–${formatTimecode(segment.source_end_seconds)}`}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        onDragOver={(event) => handleClipDragOver(event, segment.id)}
                        onDrop={(event) => handleClipDrop(event, segment.id)}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          if (
                            (event.target as HTMLElement).closest(
                              '.reel-nle__trim, .reel-nle__reorder, .reel-nle__envelope, .reel-nle__envelope-dot',
                            )
                          )
                            return;
                          onSelectGap?.(null);
                          if ((event.altKey || event.metaKey) && onVolumeKeyframes) {
                            const wave = (event.currentTarget as HTMLElement).querySelector(
                              '.reel-nle__clip-wave',
                            );
                            beginVolumeDrag(
                              event,
                              durationMs,
                              keys,
                              (points) => onVolumeKeyframes(segment.id, points),
                              wave instanceof HTMLElement ? wave : undefined,
                            );
                            return;
                          }
                          beginSegmentDrag(event, segment);
                        }}
                        onContextMenu={(event) => {
                          event.stopPropagation();
                          const clip = event.currentTarget as HTMLElement;
                          const rect = clip.getBoundingClientRect();
                          const ratio = Math.max(
                            0,
                            Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
                          );
                          const tMs = Math.round(ratio * durationMs);
                          const extras: NleMenuItem[] = [];
                          if (onVolumeKeyframes) {
                            extras.push({
                              id: `add-audio-point-${segment.id}`,
                              label: 'Agregar punto de inflexión en audio',
                              onSelect: () =>
                                onVolumeKeyframes(
                                  segment.id,
                                  upsertKeyframe(keys, tMs, interpolateGain(keys, tMs)),
                                ),
                            });
                          }
                          extras.push(...laneMenuExtras(lane, event.clientX));
                          openTimelineMenu(event, extras);
                        }}
                      >
                        <div className="reel-nle__clip-video">
                          <span className="reel-nle__clip-label">
                            {span.index + 1} · {formatDuration(span.duration)}
                          </span>
                        </div>
                        <div className="reel-nle__clip-wave">
                          {clipPeaks.length > 0 ? (
                            <svg className="reel-nle__wave" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
                              <path d={peaksPath(clipPeaks, 100, 36)} />
                            </svg>
                          ) : (
                            <span className="reel-nle__wave-fallback" aria-hidden />
                          )}
                          {onVolumeKeyframes && (
                            <div
                              className="reel-nle__envelope"
                              role="slider"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(
                                interpolateGain(keys, 0) * 100,
                              )}
                              aria-label="Volumen del video"
                              title="Arrastra arriba o abajo para el volumen"
                              onPointerDown={(event) => {
                                if (
                                  (event.target as HTMLElement).closest(
                                    '.reel-nle__envelope-dot',
                                  )
                                ) {
                                  return;
                                }
                                beginEnvelopeLevelDrag(event, keys, (points) =>
                                  onVolumeKeyframes(segment.id, points),
                                );
                              }}
                            >
                              <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
                                <polyline points={envelopePolyline(keys, durationMs)} />
                              </svg>
                              {keys.map((point) => (
                                <span
                                  key={`v-${segment.id}-${point.t_ms}`}
                                  className="reel-nle__envelope-dot"
                                  style={envelopeDotStyle(point.t_ms, durationMs, point.gain)}
                                  onPointerDown={(dotEvent) => {
                                    dotEvent.stopPropagation();
                                    const envelope = (dotEvent.currentTarget as HTMLElement).closest(
                                      '.reel-nle__envelope',
                                    );
                                    beginVolumeDrag(
                                      dotEvent,
                                      durationMs,
                                      keys,
                                      (points) => onVolumeKeyframes(segment.id, points),
                                      envelope instanceof HTMLElement ? envelope : undefined,
                                      point.t_ms,
                                    );
                                  }}
                                  onContextMenu={(dotEvent) => {
                                    dotEvent.preventDefault();
                                    dotEvent.stopPropagation();
                                    setMenu({
                                      x: dotEvent.clientX,
                                      y: dotEvent.clientY,
                                      items: [
                                        {
                                          id: `del-v-point-${point.t_ms}`,
                                          label: 'Eliminar punto',
                                          danger: true,
                                          onSelect: () =>
                                            onVolumeKeyframes(
                                              segment.id,
                                              removeKeyframe(keys, point.t_ms),
                                            ),
                                        },
                                      ],
                                    });
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        {onTrimSegment && (
                          <>
                            <button
                              type="button"
                              className="reel-nle__trim reel-nle__trim--start"
                              aria-label="Recortar inicio"
                              onPointerDown={(event) => beginTrim(event, segment, 'start')}
                            />
                            <button
                              type="button"
                              className="reel-nle__trim reel-nle__trim--end"
                              aria-label="Recortar fin"
                              onPointerDown={(event) => beginTrim(event, segment, 'end')}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                      {spans
                    .filter((span) => laneVideos.some((entry) => entry.id === span.id))
                    .map((span) => {
                        const segment = timelineSegments[span.index];
                        const nextSpan = spans[span.index + 1];
                        if (!segment || !nextSpan || (!onApplyTransition && !onJoinAtCut)) return null;
                        const joinLeft =
                          boardDuration > 0 ? ((span.start + span.duration) / boardDuration) * 100 : 0;
                        const dragActive = transitionDragOverId === segment.id;
                        const dropWidthPct =
                          boardDuration > 0
                            ? Math.max(
                                ((DEFAULT_TRANSITION_MS / 1000) * 2 * 100) / boardDuration,
                                1.6,
                              )
                            : 1.6;
                        const nextSegment = segments.find((item) => item.id === nextSpan.id);
                        const joinable = Boolean(
                          nextSegment &&
                            canJoinSourceWindows(
                              segment.source_end_seconds,
                              nextSegment.source_start_seconds,
                            ),
                        );
                        const gapKey = `${segment.id}|${nextSpan.id}`;
                        const omitted = sourceGaps.find(
                          (gap) =>
                            gap.beforeSegmentId === segment.id && gap.afterSegmentId === nextSpan.id,
                        );
                        const hasFx = segment.transition_type !== 'hard_cut';
                        return (
                          <button
                            key={`join-${segment.id}`}
                            type="button"
                            className={`reel-nle__join${dragActive ? ' reel-nle__join--dragover' : ''}${
                              joinable ? ' reel-nle__join--joinable' : ''
                            }${selectedGapKey === gapKey ? ' reel-nle__join--omitted' : ''}${
                              hasFx ? ' reel-nle__join--has-fx' : ''
                            }`}
                            style={{
                              left: `${joinLeft}%`,
                              ...(dragActive ? { width: `${dropWidthPct}%` } : null),
                            }}
                            title={
                              joinable
                                ? 'Unir este corte (U) · o suelta una transición desde Transiciones'
                                : omitted
                                  ? `Suelta aquí una transición · omitido ${formatDuration(omitted.sourceSeconds)}`
                                  : 'Suelta aquí una transición (arrástrala desde Transiciones)'
                            }
                            aria-label={
                              joinable
                                ? `Unir después del clip ${span.index + 1}`
                                : `Transición después del clip ${span.index + 1}`
                            }
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (joinable && onJoinAtCut) onJoinAtCut(segment.id);
                              else if (omitted) onSelectGap?.(gapKey);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const items: NleMenuItem[] = [];
                              if (joinable && onJoinAtCut) {
                                items.push({
                                  id: 'join',
                                  label: 'Unir corte',
                                  onSelect: () => onJoinAtCut(segment.id),
                                });
                              }
                              if (
                                onApplyTransition &&
                                segment.transition_type !== 'hard_cut'
                              ) {
                                items.push({
                                  id: 'fx-clear',
                                  label: 'Quitar transición',
                                  danger: true,
                                  onSelect: () => onApplyTransition(segment.id, 'hard_cut'),
                                });
                              }
                              if (items.length === 0) return;
                              setMenu({ x: event.clientX, y: event.clientY, items });
                            }}
                            onDragEnter={(event) => {
                              if (![...event.dataTransfer.types].includes(TRANSITION_MIME)) return;
                              event.preventDefault();
                              setTransitionDragOverId(segment.id);
                            }}
                            onDragLeave={() => setTransitionDragOverId(null)}
                            onDragOver={(event) => {
                              if (![...event.dataTransfer.types].includes(TRANSITION_MIME)) return;
                              event.preventDefault();
                              event.stopPropagation();
                              setTransitionDragOverId(segment.id);
                            }}
                            onDrop={(event) => {
                              setTransitionDragOverId(null);
                              acceptTransitionDrop(event, segment.id);
                            }}
                          />
                        );
                      })}
                  {(() => {
                    if (boardDuration <= 0) return null;
                    const items: { id: string; start: number; end: number; skip?: boolean }[] = [];
                    laneVideos.forEach((span) => {
                      items.push({
                        id: `v-${span.id}`,
                        start: span.start,
                        end: span.start + span.duration,
                        skip: Boolean(spans[span.index + 1]),
                      });
                    });
                    laneCaptions.forEach((caption) => {
                      const segment = timelineSegments[caption.index];
                      if (!segment) return;
                      const draft = captionDrafts[segment.id];
                      const start =
                        draft != null
                          ? draft.inMs / 1000
                          : segment.caption_in_ms != null
                            ? segment.caption_in_ms / 1000
                            : caption.start;
                      const end =
                        draft != null
                          ? draft.outMs / 1000
                          : segment.caption_out_ms != null
                            ? segment.caption_out_ms / 1000
                            : caption.start + caption.duration;
                      items.push({ id: `c-${segment.id}`, start, end });
                    });
                    laneOverlays.forEach((overlay) => {
                      const start = (overlayDrafts[overlay.id]?.startMs ?? overlay.start_ms) / 1000;
                      items.push({
                        id: `o-${overlay.id}`,
                        start,
                        end: start + Math.max(0.2, overlay.duration_ms / 1000),
                      });
                    });
                    items.sort((left, right) => left.start - right.start);
                    const diamonds = [];
                    for (let index = 0; index < items.length - 1; index += 1) {
                      const current = items[index];
                      const next = items[index + 1];
                      if (current.skip) continue;
                      if (Math.abs(current.end - next.start) > 0.08) continue;
                      diamonds.push(
                        <span
                          key={`pack-${current.id}-${next.id}`}
                          className="reel-nle__join reel-nle__join--packed"
                          style={{ left: `${(current.end / boardDuration) * 100}%` }}
                          title="Unión entre clips"
                        />,
                      );
                    }
                    return diamonds;
                  })()}
                  {markers.map((marker) => {
                    if (!laneVideos.some((span) => span.id === marker.segmentId)) return null;
                    const dragActive = transitionDragOverId === marker.segmentId;
                    const centerPct =
                      boardDuration > 0
                        ? marker.centerRatio * (clock.editDuration / boardDuration) * 100
                        : 0;
                    const widthPct =
                      boardDuration > 0
                        ? Math.max(marker.widthRatio * (clock.editDuration / boardDuration) * 100, 2.4)
                        : 2.4;
                    return (
                      <div
                        key={`xf-${marker.segmentId}-${marker.type}`}
                        className={`reel-nle__transition${dragActive ? ' reel-nle__transition--dragover' : ''}`}
                        style={{
                          left: `${centerPct}%`,
                          width: `${widthPct}%`,
                        }}
                        title={`${TRANSITION_LABELS[marker.type] ?? marker.type} · suelta otra para reemplazar`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDragEnter={(event) => {
                          if (![...event.dataTransfer.types].includes(TRANSITION_MIME)) return;
                          event.preventDefault();
                          setTransitionDragOverId(marker.segmentId);
                        }}
                        onDragLeave={() => setTransitionDragOverId(null)}
                        onDragOver={(event) => {
                          if (![...event.dataTransfer.types].includes(TRANSITION_MIME)) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setTransitionDragOverId(marker.segmentId);
                        }}
                        onDrop={(event) => {
                          setTransitionDragOverId(null);
                          acceptTransitionDrop(event, marker.segmentId);
                        }}
                      >
                        <span className="reel-nle__transition-band" aria-hidden="true" />
                        <button
                          type="button"
                          className="reel-nle__transition-icon"
                          draggable={Boolean(onApplyTransition)}
                          aria-label={`Transición ${TRANSITION_LABELS[marker.type] ?? marker.type}`}
                          title="Arrastra este efecto a otro corte"
                          onPointerDown={(event) => event.stopPropagation()}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (!onApplyTransition) return;
                            setMenu({
                              x: event.clientX,
                              y: event.clientY,
                              items: [
                                {
                                  id: 'fx-clear',
                                  label: 'Quitar transición',
                                  danger: true,
                                  onSelect: () => onApplyTransition(marker.segmentId, 'hard_cut'),
                                },
                              ],
                            });
                          }}
                          onDragStart={(event) => {
                            if (!onApplyTransition) return;
                            event.stopPropagation();
                            const durationMs = Math.max(
                              1,
                              Math.round(marker.overlapSeconds * 1000) || DEFAULT_TRANSITION_MS,
                            );
                            event.dataTransfer.effectAllowed = 'copy';
                            event.dataTransfer.setData(TRANSITION_MIME, marker.type);
                            event.dataTransfer.setData(TRANSITION_DURATION_MIME, String(durationMs));
                            event.dataTransfer.setData('text/plain', marker.type);
                          }}
                        >
                          <TransitionGlyph type={marker.type} className="reel-nle__transition-glyph" />
                          <span className="reel-nle__transition-caption">
                            {TRANSITION_LABELS[marker.type] ?? marker.type}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  {laneOverlays.map((overlay) => {
                    const draft = overlayDrafts[overlay.id];
                    const startSec = (draft?.startMs ?? overlay.start_ms) / 1000;
                    const durSec = Math.max(0.2, overlay.duration_ms / 1000);
                    const left = boardDuration > 0 ? (startSec / boardDuration) * 100 : 0;
                    const width =
                      boardDuration > 0 ? Math.max((durSec / boardDuration) * 100, 0.8) : 0.8;
                    const selected =
                      nleItemSelected(selection, { kind: 'overlay', id: overlay.id }) ||
                      overlay.id === selectedOverlayId;
                    const kindClass =
                      overlay.kind === 'audio' ? 'reel-nle__clip--music' : 'reel-nle__clip--overlay';
                    const sourceWindow = overlaySourceWindow(overlay);
                    const overlayTitle = sourceWindow
                      ? `Capa de video ${formatTimecode(sourceWindow.start)}–${formatTimecode(sourceWindow.end)}`
                      : overlayKindLabel(overlay.kind);
                    return (
                      <div
                        key={overlay.id}
                        role="button"
                        aria-label={overlayTitle}
                        className={`reel-nle__clip ${kindClass}${
                          selected ? ' reel-nle__clip--selected' : ''
                        }${draft ? ' reel-nle__clip--dragging' : ''}`}
                        style={{ left: `${left}%`, width: `${width}%`, touchAction: 'none' }}
                        title={overlayTitle}
                        onPointerDown={(event) => beginOverlayDrag(event, overlay)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const ids = selectedIds('overlay', overlay.id);
                          setMenu({
                            x: event.clientX,
                            y: event.clientY,
                            items: [
                              {
                                id: 'del-ov',
                                label:
                                  ids.length > 1
                                    ? `Eliminar ${ids.length}`
                                    : `Eliminar ${overlayKindLabel(overlay.kind).toLowerCase()}`,
                                danger: true,
                                disabled: !onDeleteOverlay,
                                onSelect: () => ids.forEach((id) => onDeleteOverlay?.(id)),
                              },
                            ],
                          });
                        }}
                      >
                        <span className="reel-nle__clip-label">
                          {overlay.kind === 'text'
                            ? overlayTextLabel(overlay.text).slice(0, 24)
                            : sourceWindow
                              ? 'Capa de video'
                              : overlayKindLabel(overlay.kind)}
                        </span>
                      </div>
                    );
                  })}
                  {laneCaptions.map((span) => {
                    const segment = timelineSegments[span.index];
                    if (!segment) return null;
                    const selected = nleItemSelected(selection, {
                      kind: 'caption',
                      id: segment.id,
                    });
                    const label = (captionLabels[segment.id] ?? '').trim();
                    const draft = captionDrafts[segment.id] ?? null;
                    const startSec =
                      draft != null
                        ? draft.inMs / 1000
                        : segment.caption_in_ms != null
                          ? segment.caption_in_ms / 1000
                          : span.start;
                    const endSec =
                      draft != null
                        ? draft.outMs / 1000
                        : segment.caption_out_ms != null
                          ? segment.caption_out_ms / 1000
                          : span.start + span.duration;
                    const durSec = Math.max(0.2, endSec - startSec);
                    const leftPct = boardDuration > 0 ? (startSec / boardDuration) * 100 : 0;
                    const widthPct =
                      boardDuration > 0 ? Math.max((durSec / boardDuration) * 100, 0.4) : 0.4;
                    const captionName = label || `Subtítulos · fragmento ${span.index + 1}`;
                    return (
                      <div
                        key={`cc-${span.id}`}
                        role="button"
                        className={`reel-nle__clip reel-nle__clip--caption${selected ? ' reel-nle__clip--selected' : ''}${draft ? ' reel-nle__clip--dragging' : ''}`}
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          touchAction: 'none',
                        }}
                        title={captionName}
                        aria-label={captionName}
                        onPointerDown={(event) => {
                          if ((event.target as HTMLElement).closest('.reel-nle__trim')) return;
                          event.stopPropagation();
                          onSelectSegment(segment.id, 'captions');
                          beginCaptionDrag(event, segment, span.start, span.duration, 'move');
                        }}
                        onContextMenu={(event) => openCaptionMenu(event, segment.id)}
                      >
                        <span
                          className="reel-nle__clip-label"
                          onContextMenu={(event) => openCaptionMenu(event, segment.id)}
                        >
                          {label ? label.slice(0, 28) : '—'}
                        </span>
                        {onMoveCaption && (
                          <>
                            <button
                              type="button"
                              className="reel-nle__trim reel-nle__trim--start"
                              aria-label="Recortar inicio del subtítulo"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                beginCaptionDrag(event, segment, span.start, span.duration, 'start');
                              }}
                            />
                            <button
                              type="button"
                              className="reel-nle__trim reel-nle__trim--end"
                              aria-label="Recortar fin del subtítulo"
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                beginCaptionDrag(event, segment, span.start, span.duration, 'end');
                              }}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                  {showMusic ? (
                    <div
                      className={`reel-nle__clip reel-nle__clip--music${
                        nleItemSelected(selection, { kind: 'music', id: 'music' })
                          ? ' reel-nle__clip--selected'
                          : ''
                      }`}
                      style={{
                        left: '0%',
                        width: `${boardDuration > 0 ? Math.min(100, (editDuration / boardDuration) * 100) : 100}%`,
                      }}
                      title={musicLabel}
                      onPointerDown={(event) => {
                        if (
                          (event.target as HTMLElement).closest(
                            '.reel-nle__envelope, .reel-nle__envelope-dot',
                          )
                        ) {
                          return;
                        }
                        event.stopPropagation();
                        commitSelection({ kind: 'music', id: 'music' }, modifierSelect(event));
                        if ((event.altKey || event.metaKey) && onMusicVolumeKeyframes) {
                          const keys = normalizeKeyframes(musicKeyframes);
                          beginVolumeDrag(
                            event,
                            Math.max(200, totalDuration * 1000),
                            keys,
                            onMusicVolumeKeyframes,
                          );
                          return;
                        }
                        beginScrub(event);
                      }}
                      onPointerMove={(event) => {
                        if (event.buttons !== 1) return;
                        const nextLane = laneFromClientY(event.clientY);
                        if (nextLane == null || nextLane === lane) return;
                        const candidate: Occupant = {
                          id: occupantId('music', 'music'),
                          kind: 'music',
                          start: 0,
                          end: editDuration,
                        };
                        const free = exclusiveLaneFor(candidate, nextLane, [
                          occupantId('music', 'music'),
                        ]);
                        if (free == null || free === lane) return;
                        persistLanes({
                          ...laneLayoutRef.current,
                          laneCount,
                          musicLane: free,
                        });
                      }}
                    >
                      {musicPeaks.length > 0 && (
                        <svg className="reel-nle__wave" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
                          <path d={peaksPath(musicPeaks, 100, 36)} />
                        </svg>
                      )}
                      <span className="reel-nle__clip-label">{musicLabel}</span>
                      {onMusicVolumeKeyframes && (
                        <div
                          className="reel-nle__envelope"
                          role="slider"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(
                            interpolateGain(musicKeyframes, 0) * 100,
                          )}
                          aria-label="Volumen de la música"
                          title="Arrastra arriba o abajo para el volumen"
                          onPointerDown={(event) => {
                            if (
                              (event.target as HTMLElement).closest(
                                '.reel-nle__envelope-dot',
                              )
                            ) {
                              return;
                            }
                            beginEnvelopeLevelDrag(
                              event,
                              normalizeKeyframes(musicKeyframes),
                              onMusicVolumeKeyframes,
                            );
                          }}
                        >
                          <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
                            <polyline
                              points={envelopePolyline(
                                musicKeyframes,
                                Math.max(200, totalDuration * 1000),
                              )}
                            />
                          </svg>
                          {normalizeKeyframes(musicKeyframes).map((point) => {
                            const durationMs = Math.max(200, totalDuration * 1000);
                            return (
                              <span
                                key={`m-${point.t_ms}`}
                                className="reel-nle__envelope-dot"
                                style={envelopeDotStyle(point.t_ms, durationMs, point.gain)}
                                onPointerDown={(dotEvent) => {
                                  const envelope = (dotEvent.currentTarget as HTMLElement).closest(
                                    '.reel-nle__envelope',
                                  );
                                  beginVolumeDrag(
                                    dotEvent,
                                    durationMs,
                                    normalizeKeyframes(musicKeyframes),
                                    onMusicVolumeKeyframes,
                                    envelope instanceof HTMLElement ? envelope : undefined,
                                    point.t_ms,
                                  );
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setMenu({
                                    x: event.clientX,
                                    y: event.clientY,
                                    items: [
                                      {
                                        id: 'del-m-point',
                                        label: 'Eliminar punto',
                                        danger: true,
                                        onSelect: () =>
                                          onMusicVolumeKeyframes(
                                            removeKeyframe(musicKeyframes, point.t_ms),
                                          ),
                                      },
                                    ],
                                  });
                                }}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="reel-nle__add-lane reel-nle__add-lane--below"
          title="Añadir franja abajo"
          aria-label="Añadir franja abajo"
          onClick={() => persistLanes(insertLane({ ...laneLayoutRef.current, laneCount }, 0))}
        >
          +
        </button>
      </div>
      {menu ? <NleContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </div>
  );
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
