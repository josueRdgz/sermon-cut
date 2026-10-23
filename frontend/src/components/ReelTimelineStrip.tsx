import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from 'react';

import { overlayKindLabel, overlaySourceWindow, type ReelOverlay } from '../types/overlay';
import type { ReelSegment, TransitionType } from '../types/reel';
import { formatDuration, formatTimecode } from '../utils/format';
import {
  assignLanes,
  clampLane,
  defaultLaneLayout,
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
import { transitionMarkerAt } from '../utils/reelOutputClock';
import {
  buildClipSpans,
  buildSourceGaps,
  outputTimeFromTrackRatio,
  playheadPercent,
  pxToTime,
  shiftCaptionWindow,
  timeToPx,
} from '../utils/reelTimelineStrip';
import { canJoinSourceWindows } from '../utils/reelTrim';
import {
  envelopePolyline,
  normalizeKeyframes,
  peaksPath,
  removeKeyframe,
  seedEndpoints,
  slicePeaks,
  upsertKeyframe,
  type VolumeKeyframe,
} from '../utils/volumeEnvelope';
import { TRANSITION_MIME, TRANSITION_OPTIONS } from './nle/clipConstants';
import { NleContextMenu, type NleMenuItem } from './nle/NleContextMenu';

export type TimelineTrackKind = 'video' | 'overlays' | 'captions' | 'music';

const ASSET_MIME = 'application/x-sermon-asset';
const MIN_PX_PER_SECOND = 40;
const MAX_PX_PER_SECOND = 200;
const DEFAULT_PX_PER_SECOND = 80;

interface ReelTimelineStripProps {
  reelId?: string;
  segments: ReelSegment[];
  overlays?: ReelOverlay[];
  /** Prefer `buildOutputClock(segments).totalDuration`. */
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
  onTrimSegment?: (
    id: string,
    patch: { source_start_seconds?: number; source_end_seconds?: number },
  ) => void;
  onMoveCaption?: (id: string, inMs: number, outMs: number, persist?: boolean) => void;
  onMoveCaptions?: (
    items: { id: string; inMs: number; outMs: number }[],
    persist?: boolean,
  ) => void;
  onApplyTransition?: (segmentId: string, type: TransitionType) => void;
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
  const [captionDraft, setCaptionDraft] = useState<{
    id: string;
    inMs: number;
    outMs: number;
    lane: number;
  } | null>(null);
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
      if (overlayIds.length === 0 && segmentIds.length === 0) return;
      event.preventDefault();
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
  }, [onDeleteOverlay, onDeleteSegments]);

  const pxPerSecond = clampZoom(pxPerSecondProp ?? localZoom);

  useEffect(() => {
    if (!reelId) return;
    setLaneLayout(loadLaneLayout(reelId));
  }, [reelId]);

  const persistLanes = useCallback(
    (next: NleLaneLayout) => {
      setLaneLayout(next);
      if (reelId) saveLaneLayout(reelId, next);
    },
    [reelId],
  );

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

  const spans = useMemo(() => buildClipSpans(segments), [segments]);
  const sourceGaps = useMemo(() => buildSourceGaps(segments), [segments]);
  const markers = useMemo(
    () => transitionMarkerAt(
      spans.map((span) => ({
        id: span.id,
        index: span.index,
        sourceStart: segments[span.index]?.source_start_seconds ?? 0,
        sourceEnd: segments[span.index]?.source_end_seconds ?? 0,
        outputStart: span.start,
        contentDuration: span.duration,
        overlapSeconds: 0,
      })),
      segments,
    ),
    [spans, segments],
  );
  const timelineWidthPx = Math.max(timeToPx(totalDuration, pxPerSecond), 1);
  const playhead = playheadPercent(outputTime, totalDuration);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || totalDuration <= 0) return;
    const x = timeToPx(outputTime, pxPerSecond);
    const left = scroller.scrollLeft;
    const right = left + scroller.clientWidth;
    const margin = 72;
    if (x < left + margin || x > right - margin) {
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.33);
    }
  }, [outputTime, pxPerSecond, totalDuration]);

  function seekToClientX(clientX: number) {
    const surface = surfaceRef.current;
    if (!surface || totalDuration <= 0) return null;
    const output = timeFromClientX(clientX, surface, totalDuration, pxPerSecond);
    onSeek(output);
    return output;
  }

  function beginScrub(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
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
      if (onMoveOverlays) onMoveOverlays(last, false);
    };

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      apply(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      apply(upEvent.clientX, upEvent.clientY);
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
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function beginSegmentDrag(event: PointerEvent<HTMLElement>, segment: ReelSegment) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const item: NleItemRef = { kind: 'segment', id: segment.id };
    if (!nleItemSelected(selectionRef.current, item) || !modifierSelect(event)) {
      commitSelection(item, modifierSelect(event));
    } else {
      onSelectSegment(segment.id, 'video');
    }
    const groupIds = selectedIds('segment', segment.id);
    const originLane = laneForSegment(layoutWithCount, segment.id);
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startX = event.clientX;
    let lastLane = originLane;

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      autoScrollBoard(moveEvent.clientY);
      const hover = laneFromClientY(moveEvent.clientY);
      if (hover != null) lastLane = hover;
      setSegmentDraft({
        ids: groupIds,
        dx: moveEvent.clientX - startX,
        dy: moveEvent.clientY - startY,
        lane: lastLane,
      });
    };

    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setSegmentDraft(null);
      const dropLane = laneFromClientY(upEvent.clientY) ?? lastLane;
      const dy = upEvent.clientY - startY;
      const dx = upEvent.clientX - startX;
      if (dropLane != null && Math.abs(dy) > 10 && dropLane !== originLane) {
        persistLanes(
          assignLanes({ ...laneLayoutRef.current, laneCount }, groupIds, dropLane, 'segmentLanes'),
        );
        return;
      }
      if (Math.abs(dx) < 4) return;
      const surface = surfaceRef.current;
      if (!surface || !onReorderSegments) return;
      const output = timeFromClientX(upEvent.clientX, surface, totalDuration, pxPerSecond);
      const targetId = segmentAtOutput(spans, output);
      if (!targetId || groupIds.includes(targetId)) return;
      const ids = segments.map((entry) => entry.id);
      const moving = ids.filter((id) => groupIds.includes(id));
      const rest = ids.filter((id) => !groupIds.includes(id));
      const insertAt = rest.indexOf(targetId);
      if (insertAt < 0) return;
      rest.splice(insertAt, 0, ...moving);
      onReorderSegments(rest);
    };

    setSegmentDraft({ ids: groupIds, dx: 0, dy: 0, lane: originLane });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
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
    const layoutNow = { ...laneLayoutRef.current, laneCount };
    const groupIds = edge === 'move' ? selectedIds('caption', segment.id) : [segment.id];
    const origins = groupIds.map((id) => {
      const index = segments.findIndex((entry) => entry.id === id);
      const span = spans[index];
      const entry = segments[index];
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
    let last = origins;

    const apply = (clientX: number, clientY: number) => {
      autoScrollBoard(clientY);
      const deltaMs = Math.round(pxToTime(clientX - startX, pxPerSecond) * 1000);
      const hover = laneFromClientY(clientY);
      const dropLane = Math.abs(clientY - startY) > 10 && hover != null ? hover : null;
      last = origins.map((origin) => ({
        ...shiftCaptionWindow(origin.inMs, origin.outMs, deltaMs, edge, totalMs),
        id: origin.id,
        lane: dropLane != null ? dropLane : origin.lane,
      }));
      const primary = last.find((entry) => entry.id === segment.id) ?? last[0];
      setCaptionDraft({ id: primary.id, inMs: primary.inMs, outMs: primary.outMs, lane: primary.lane });
      if (onMoveCaptions) onMoveCaptions(last, false);
      else last.forEach((entry) => onMoveCaption(entry.id, entry.inMs, entry.outMs, false));
    };

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      apply(moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      apply(upEvent.clientX, upEvent.clientY);
      const layout = laneLayoutRef.current;
      const nextLanes = { ...layout.captionLanes };
      let lanesChanged = false;
      last.forEach((entry, index) => {
        if (entry.lane !== origins[index]?.lane) {
          nextLanes[entry.id] = entry.lane;
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
      if (onMoveCaptions) onMoveCaptions(last, true);
      else last.forEach((entry) => onMoveCaption(entry.id, entry.inMs, entry.outMs, true));
      setCaptionDraft(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
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

  function acceptTransitionDrop(event: DragEvent, segmentId: string) {
    const type = event.dataTransfer.getData(TRANSITION_MIME) as TransitionType;
    if (!type || !onApplyTransition) return;
    event.preventDefault();
    event.stopPropagation();
    onApplyTransition(segmentId, type);
  }

  function handleSurfaceDrop(event: DragEvent<HTMLElement>, lane?: number) {
    event.preventDefault();
    setDragOver(false);
    const assetId = event.dataTransfer.getData(ASSET_MIME);
    if (!assetId || !onDropAsset || !surfaceRef.current) return;
    const output = timeFromClientX(
      event.clientX,
      surfaceRef.current,
      totalDuration,
      pxPerSecond,
    );
    onDropAsset(assetId, output, lane);
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
          if (!surfaceRef.current) return;
          const output = timeFromClientX(clientX, surfaceRef.current, totalDuration, pxPerSecond);
          onAddTextOverlay?.(output, lane);
        },
      },
      {
        id: 'add-lane-above',
        label: 'Añadir franja arriba',
        onSelect: () => persistLanes(insertLane({ ...laneLayoutRef.current, laneCount }, lane + 1)),
      },
      {
        id: 'add-lane-below',
        label: 'Añadir franja abajo',
        onSelect: () => persistLanes(insertLane({ ...laneLayoutRef.current, laneCount }, lane)),
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

  function transitionMenuItems(segmentId: string): NleMenuItem[] {
    return TRANSITION_OPTIONS.map((option) => ({
      id: `fx-${option.value}`,
      label: option.label,
      onSelect: () => onApplyTransition?.(segmentId, option.value),
    }));
  }

  function zoomMenuItems(): NleMenuItem[] {
    return [
      {
        id: 'zoom-in',
        label: 'Acercar línea temporal',
        disabled: pxPerSecond >= MAX_PX_PER_SECOND,
        onSelect: () => setZoom(pxPerSecond + 20),
      },
      {
        id: 'zoom-out',
        label: 'Alejar línea temporal',
        disabled: pxPerSecond <= MIN_PX_PER_SECOND,
        onSelect: () => setZoom(pxPerSecond - 20),
      },
    ];
  }

  function openTimelineMenu(event: ReactMouseEvent, extras: NleMenuItem[] = []) {
    event.preventDefault();
    event.stopPropagation();
    const output =
      surfaceRef.current != null
        ? timeFromClientX(event.clientX, surfaceRef.current, totalDuration, pxPerSecond)
        : outputTime;
    onSeek(output);
    const clipId = segmentAtOutput(spans, output);
    const leftJoinId = joinNear(output);
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
        label: 'Partir aquí (C)',
        disabled: !onSplitAtPlayhead || !clipId,
        onSelect: () => onSplitAtPlayhead?.(output),
      },
      {
        id: 'join',
        label: canJoin ? 'Unir en este corte (U)' : 'Unir (U · clic en la unión que partiste tú)',
        disabled: !canJoin,
        onSelect: () => {
          if (leftJoinId) onJoinAtCut?.(leftJoinId);
        },
      },
      ...zoomMenuItems(),
    ];
    const fxTarget = leftJoinId ?? (clipId && clipId !== spans[spans.length - 1]?.id ? clipId : null);
    if (onApplyTransition && fxTarget) {
      items.push({
        id: 'fx',
        label: 'Transición',
        items: transitionMenuItems(fxTarget),
      });
      const fxSegment = segments.find((item) => item.id === fxTarget);
      if (fxSegment && fxSegment.transition_type !== 'hard_cut') {
        items.push({
          id: 'fx-clear',
          label: 'Quitar transición',
          danger: true,
          onSelect: () => onApplyTransition(fxTarget, 'hard_cut'),
        });
      }
    }
    const clickLane = laneFromClientY(event.clientY);
    const clipOnLane =
      clipId != null &&
      clickLane != null &&
      laneForSegment({ ...laneLayoutRef.current, laneCount }, clipId) === clickLane;
    if (clipOnLane && onDeleteSegments) {
      const ids = selectedIds('segment', clipId);
      items.push({
        id: 'del-clip',
        label: ids.length > 1 ? `Eliminar ${ids.length} cortes` : 'Eliminar corte',
        danger: true,
        onSelect: () => onDeleteSegments(ids),
      });
    }
    items.push(...extras);
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

  if (segments.length === 0 || totalDuration <= 0) {
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
      }${segmentDraft ? ' reel-nle__strip--lane-drag' : ''}`}
      aria-label="Línea temporal del Reel"
    >
      <button
        type="button"
        className="reel-nle__add-lane reel-nle__add-lane--above"
        title="Añadir franja arriba"
        aria-label="Añadir franja arriba"
        onClick={() => persistLanes(insertLane({ ...laneLayoutRef.current, laneCount }, laneCount))}
      >
        +
      </button>
      <div ref={boardRef} className="reel-nle__board">
        <div className="reel-nle__label-col" aria-hidden="true">
          <span className="reel-nle__track-label reel-nle__track-label--spacer" />
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

        <div ref={scrollRef} className="reel-nle__scroll">
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
            <div className="reel-nle__ruler" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((mark) => (
                <span
                  key={mark}
                  className="reel-nle__ruler-mark"
                  style={{ left: `${mark * 100}%` }}
                >
                  {formatDuration(totalDuration * mark)}
                </span>
              ))}
            </div>

            <button
              type="button"
              className="reel-nle__playhead"
              style={{ left: `${playhead}%` }}
              aria-label="Cursor de reproducción"
              title="Arrastra para mover la posición"
              onPointerDown={(event) => {
                event.stopPropagation();
                beginScrub(event);
              }}
            >
              <span className="reel-nle__playhead-head" />
              <span className="reel-nle__playhead-line" />
            </button>

            {Array.from({ length: laneCount }, (_, i) => laneCount - 1 - i).map((lane) => {
              const laneOverlays = overlays.filter((overlay) => {
                const z = overlayDrafts[overlay.id]?.lane ?? overlay.z_index;
                return clampLane(z, laneCount) === lane;
              });
              const laneCaptions = spans.filter((span) => {
                if (captionDraft?.id === segments[span.index].id) return captionDraft.lane === lane;
                return laneForCaption(layoutWithCount, segments[span.index].id) === lane;
              });
              const laneVideos = spans.filter((span) => {
                return laneForSegment(layoutWithCount, segments[span.index].id) === lane;
              });
              const showMusic = musicActive && clampLane(laneLayout.musicLane, laneCount) === lane;
              const dropHover = segmentDraft != null && segmentDraft.lane === lane;
              const hasVideo = laneVideos.length > 0 || dropHover;
              const empty =
                laneOverlays.length === 0 &&
                laneCaptions.length === 0 &&
                !showMusic &&
                !hasVideo;
              return (
                <div
                  key={`lane-${lane}`}
                  data-lane={lane}
                  className={`reel-nle__track${hasVideo ? ' reel-nle__track--aroll' : ' reel-nle__track--free'}${
                    dropHover ? ' reel-nle__track--drop' : ''
                  }`}
                  aria-label={`Franja ${lane + 1}`}
                  onDoubleClick={(event) => {
                    if (!onAddTextOverlay || !surfaceRef.current) return;
                    event.stopPropagation();
                    const output = timeFromClientX(
                      event.clientX,
                      surfaceRef.current,
                      totalDuration,
                      pxPerSecond,
                    );
                    onAddTextOverlay(output, lane);
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
                  {empty ? (
                    <span className="reel-nle__track-empty muted">
                      Suelta un archivo o arrastra un corte de video · Mayús+clic = varios
                    </span>
                  ) : null}
                  {laneVideos.map((span) => {
                    const segment = segments[span.index];
                    const selected =
                      nleItemSelected(selection, { kind: 'segment', id: segment.id }) ||
                      segment.id === selectedSegmentId;
                    const dragging = Boolean(segmentDraft?.ids.includes(segment.id));
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
                          left: `calc(${span.leftRatio * 100}% + 3px)`,
                          width: `calc(${Math.max(span.widthRatio * 100, 0.8)}% - 6px)`,
                          transform: dragging && segmentDraft
                            ? `translate(${segmentDraft.dx}px, ${segmentDraft.dy}px)`
                            : undefined,
                          zIndex: dragging ? 12 : undefined,
                          willChange: dragging ? 'transform' : undefined,
                        }}
                        title={`Fragmento ${span.index + 1} · ${formatTimecode(segment.source_start_seconds)}–${formatTimecode(segment.source_end_seconds)}`}
                        onDragOver={(event) => handleClipDragOver(event, segment.id)}
                        onDrop={(event) => handleClipDrop(event, segment.id)}
                        onPointerDown={(event) => {
                          if (
                            (event.target as HTMLElement).closest(
                              '.reel-nle__trim, .reel-nle__reorder, .reel-nle__envelope, .reel-nle__envelope-dot',
                            )
                          )
                            return;
                          event.stopPropagation();
                          onSelectGap?.(null);
                          beginSegmentDrag(event, segment);
                        }}
                        onContextMenu={(event) => {
                          event.stopPropagation();
                          openTimelineMenu(event, laneMenuExtras(lane, event.clientX));
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
                              aria-label="Volumen del video"
                              onPointerDown={(event) =>
                                beginVolumeDrag(event, durationMs, keys, (points) =>
                                  onVolumeKeyframes(segment.id, points),
                                )
                              }
                            >
                              <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden>
                                <polyline points={envelopePolyline(keys, durationMs)} />
                              </svg>
                              {keys.map((point) => (
                                <span
                                  key={`v-${segment.id}-${point.t_ms}`}
                                  className="reel-nle__envelope-dot"
                                  style={{
                                    left: `${(point.t_ms / durationMs) * 100}%`,
                                    top: `${(1 - point.gain) * 100}%`,
                                  }}
                                  onPointerDown={(dotEvent) => {
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
                  {sourceGaps
                    .filter((gap) =>
                      laneVideos.some((span) => span.id === gap.beforeSegmentId),
                    )
                    .map((gap) => {
                      const gapKey = `${gap.beforeSegmentId}|${gap.afterSegmentId}`;
                      const selected = selectedGapKey === gapKey;
                      return (
                        <button
                          key={gapKey}
                          type="button"
                          className={`reel-nle__omitted${selected ? ' reel-nle__omitted--selected' : ''}`}
                          style={{ left: `${gap.leftRatio * 100}%` }}
                          title={`Omitido en el sermón: ${formatDuration(gap.sourceSeconds)}`}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            onSelectGap?.(gapKey);
                          }}
                        >
                          <span className="visually-hidden">
                            Material omitido {formatDuration(gap.sourceSeconds)}
                          </span>
                        </button>
                      );
                    })}
                  {spans
                    .filter((span) => laneVideos.some((entry) => entry.id === span.id))
                    .map((span) => {
                        const segment = segments[span.index];
                        const nextSpan = spans[span.index + 1];
                        if (!segment || !nextSpan || (!onApplyTransition && !onJoinAtCut)) return null;
                        const joinLeft = nextSpan.leftRatio * 100;
                        const dragActive = transitionDragOverId === segment.id;
                        const nextSegment = segments.find((item) => item.id === nextSpan.id);
                        const joinable = Boolean(
                          nextSegment &&
                            canJoinSourceWindows(
                              segment.source_end_seconds,
                              nextSegment.source_start_seconds,
                            ),
                        );
                        return (
                          <button
                            key={`join-${segment.id}`}
                            type="button"
                            className={`reel-nle__join${dragActive ? ' reel-nle__join--dragover' : ''}${
                              joinable ? ' reel-nle__join--joinable' : ''
                            }`}
                            style={{ left: `${joinLeft}%` }}
                            title={
                              joinable
                                ? 'Unir este corte (U) · o suelta una transición'
                                : 'Suelta aquí una transición (arrastra desde la bandeja o un diamante)'
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
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const items: NleMenuItem[] = [];
                              if (joinable && onJoinAtCut) {
                                items.push({
                                  id: 'join',
                                  label: 'Unir (U)',
                                  onSelect: () => onJoinAtCut(segment.id),
                                });
                              }
                              if (onApplyTransition) {
                                items.push(
                                  {
                                    id: 'fx',
                                    label: 'Cambiar transición',
                                    items: transitionMenuItems(segment.id),
                                  },
                                  {
                                    id: 'fx-clear',
                                    label: 'Quitar transición',
                                    danger: true,
                                    disabled: segment.transition_type === 'hard_cut',
                                    onSelect: () => onApplyTransition(segment.id, 'hard_cut'),
                                  },
                                );
                              }
                              items.push(...zoomMenuItems());
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
                  {markers.map((marker, index) => {
                    const segment = segments[index];
                    if (!segment || !laneVideos.some((span) => span.id === segment.id)) return null;
                    return (
                      <div
                        key={`xf-${index}-${marker.type}`}
                        className="reel-nle__transition"
                        style={{ left: `${marker.leftRatio * 100}%` }}
                        title={TRANSITION_LABELS[marker.type] ?? marker.type}
                      >
                        <button
                          type="button"
                          className="reel-nle__transition-diamond"
                          draggable={Boolean(onApplyTransition)}
                          aria-label={`Transición ${TRANSITION_LABELS[marker.type] ?? marker.type}`}
                          title="Arrastra este efecto a otra unión entre clips"
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
                                  id: 'fx',
                                  label: 'Cambiar transición',
                                  items: transitionMenuItems(segment.id),
                                },
                                {
                                  id: 'fx-clear',
                                  label: 'Quitar transición',
                                  danger: true,
                                  disabled: segment.transition_type === 'hard_cut',
                                  onSelect: () => onApplyTransition(segment.id, 'hard_cut'),
                                },
                                ...zoomMenuItems(),
                              ],
                            });
                          }}
                          onDragStart={(event) => {
                            if (!onApplyTransition) return;
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = 'copy';
                            event.dataTransfer.setData(TRANSITION_MIME, segment.transition_type);
                            event.dataTransfer.setData('text/plain', segment.transition_type);
                          }}
                        />
                        <span className="reel-nle__transition-label">
                          {TRANSITION_LABELS[marker.type] ?? marker.type}
                        </span>
                      </div>
                    );
                  })}
                  {laneOverlays.map((overlay) => {
                    const draft = overlayDrafts[overlay.id];
                    const startSec = (draft?.startMs ?? overlay.start_ms) / 1000;
                    const durSec = Math.max(0.2, overlay.duration_ms / 1000);
                    const left = totalDuration > 0 ? (startSec / totalDuration) * 100 : 0;
                    const width =
                      totalDuration > 0 ? Math.max((durSec / totalDuration) * 100, 0.8) : 0.8;
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
                              ...zoomMenuItems(),
                            ],
                          });
                        }}
                      >
                        <span className="reel-nle__clip-label">
                          {overlay.kind === 'text'
                            ? (overlay.text || 'Texto').slice(0, 24)
                            : sourceWindow
                              ? 'Capa de video'
                              : overlayKindLabel(overlay.kind)}
                        </span>
                      </div>
                    );
                  })}
                  {laneCaptions.map((span) => {
                    const segment = segments[span.index];
                    const selected =
                      nleItemSelected(selection, { kind: 'caption', id: segment.id }) ||
                      segment.id === selectedSegmentId;
                    const label = (captionLabels[segment.id] ?? '').trim();
                    const draft = captionDraft?.id === segment.id ? captionDraft : null;
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
                    const leftPct = totalDuration > 0 ? (startSec / totalDuration) * 100 : 0;
                    const widthPct =
                      totalDuration > 0 ? Math.max((durSec / totalDuration) * 100, 0.4) : 0.4;
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
                        onContextMenu={(event) => openTimelineMenu(event)}
                      >
                        <span
                          className="reel-nle__clip-label"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            onSelectSegment(segment.id, 'captions');
                            beginCaptionDrag(event, segment, span.start, span.duration, 'move');
                          }}
                          onContextMenu={(event) => openTimelineMenu(event)}
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
                      style={{ left: '0%', width: '100%' }}
                      title={musicLabel}
                      onPointerDown={(event) => {
                        if ((event.target as HTMLElement).closest('.reel-nle__envelope')) return;
                        event.stopPropagation();
                        commitSelection({ kind: 'music', id: 'music' }, modifierSelect(event));
                        beginScrub(event);
                      }}
                      onPointerMove={(event) => {
                        if (event.buttons !== 1) return;
                        const nextLane = laneFromClientY(event.clientY);
                        if (nextLane != null && nextLane !== lane) {
                          persistLanes({
                            ...laneLayout,
                            laneCount,
                            musicLane: nextLane,
                          });
                        }
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
                          aria-label="Volumen de la música"
                          onPointerDown={(event) => {
                            const keys = normalizeKeyframes(musicKeyframes);
                            beginVolumeDrag(event, Math.max(200, totalDuration * 1000), keys, onMusicVolumeKeyframes);
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
                                style={{
                                  left: `${(point.t_ms / durationMs) * 100}%`,
                                  top: `${(1 - point.gain) * 100}%`,
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
      {menu ? <NleContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} /> : null}
    </div>
  );
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
