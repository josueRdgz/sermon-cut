import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react';

import type { ReelOverlay } from '../types/overlay';
import type { ReelSegment, TransitionType } from '../types/reel';
import { formatDuration, formatTimecode } from '../utils/format';
import { transitionMarkerAt } from '../utils/reelOutputClock';
import {
  buildClipSpans,
  buildSourceGaps,
  outputTimeFromTrackRatio,
  playheadPercent,
  pxToTime,
  timeToPx,
} from '../utils/reelTimelineStrip';
import { TRANSITION_MIME, TRANSITION_OPTIONS } from './nle/clipConstants';

export type TimelineTrackKind = 'video' | 'overlays' | 'captions' | 'music';

const ASSET_MIME = 'application/x-sermon-asset';
const MIN_PX_PER_SECOND = 40;
const MAX_PX_PER_SECOND = 200;
const DEFAULT_PX_PER_SECOND = 80;

interface ReelTimelineStripProps {
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
  onMoveCaption?: (id: string, inMs: number, outMs: number) => void;
  onApplyTransition?: (segmentId: string, type: TransitionType) => void;
  onMoveOverlay?: (id: string, startMs: number) => void;
  onDropAsset?: (assetId: string, outputSeconds: number) => void;
  onAddTextOverlay?: (outputSeconds: number) => void;
}

const TRANSITION_LABELS: Record<string, string> = {
  short_crossfade: 'Fundido',
  dip_to_black: 'Negro',
  fade: 'Fade',
  flash: 'Flash',
};

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
  onApplyTransition,
  onMoveOverlay,
  onDropAsset,
  onAddTextOverlay,
}: ReelTimelineStripProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [localZoom, setLocalZoom] = useState(DEFAULT_PX_PER_SECOND);
  const [dragOver, setDragOver] = useState(false);
  const [transitionDragOverId, setTransitionDragOverId] = useState<string | null>(null);
  const reorderDragIdRef = useRef<string | null>(null);
  const [reorderOverId, setReorderOverId] = useState<string | null>(null);

  const pxPerSecond = clampZoom(pxPerSecondProp ?? localZoom);

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
    if (event.button !== 0 || !onMoveOverlay) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectOverlay?.(overlay.id);
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startMs = overlay.start_ms;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaSec = pxToTime(moveEvent.clientX - startX, pxPerSecond);
      const nextMs = Math.max(0, Math.round(startMs + deltaSec * 1000));
      onMoveOverlay(overlay.id, nextMs);
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

  function beginCaptionDrag(
    event: PointerEvent<HTMLElement>,
    segment: ReelSegment,
    spanStart: number,
    spanDuration: number,
    edge: 'move' | 'start' | 'end',
  ) {
    if (event.button !== 0 || !onMoveCaption) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectSegment(segment.id, 'captions');
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const inMs = segment.caption_in_ms ?? Math.round(spanStart * 1000);
    const outMs = segment.caption_out_ms ?? Math.round((spanStart + spanDuration) * 1000);
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaMs = Math.round(pxToTime(moveEvent.clientX - startX, pxPerSecond) * 1000);
      let nextIn = inMs;
      let nextOut = outMs;
      if (edge === 'move') {
        nextIn = Math.max(0, inMs + deltaMs);
        nextOut = Math.max(nextIn + 200, outMs + deltaMs);
      } else if (edge === 'start') {
        nextIn = Math.max(0, Math.min(outMs - 200, inMs + deltaMs));
      } else {
        nextOut = Math.max(inMs + 200, outMs + deltaMs);
      }
      onMoveCaption(segment.id, nextIn, nextOut);
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

  function acceptTransitionDrop(event: DragEvent, segmentId: string) {
    const type = event.dataTransfer.getData(TRANSITION_MIME) as TransitionType;
    if (!type || !onApplyTransition) return;
    event.preventDefault();
    event.stopPropagation();
    onApplyTransition(segmentId, type);
  }

  function handleSurfaceDrop(event: DragEvent<HTMLDivElement>) {
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
    onDropAsset(assetId, output);
  }

  function handleClipDragStart(event: DragEvent<HTMLDivElement>, segmentId: string) {
    if (!onReorderSegments) {
      event.preventDefault();
      return;
    }
    reorderDragIdRef.current = segmentId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', segmentId);
  }

  function handleClipDragOver(event: DragEvent<HTMLDivElement>, segmentId: string) {
    if (!reorderDragIdRef.current || reorderDragIdRef.current === segmentId) return;
    event.preventDefault();
    setReorderOverId(segmentId);
  }

  function handleClipDrop(event: DragEvent<HTMLDivElement>, targetId: string) {
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
      }`}
      aria-label="Línea temporal del Reel"
    >
      <div className="reel-nle__strip-meta">
        <span>{formatDuration(outputTime)}</span>
        <span className="muted">/ {formatDuration(totalDuration)}</span>
        <div className="reel-nle__zoom" role="group" aria-label="Zoom de la línea temporal">
          <button
            type="button"
            className="button button--inline"
            aria-label="Alejar"
            onClick={() => setZoom(pxPerSecond - 20)}
            disabled={pxPerSecond <= MIN_PX_PER_SECOND}
          >
            −
          </button>
          <input
            type="range"
            min={MIN_PX_PER_SECOND}
            max={MAX_PX_PER_SECOND}
            step={5}
            value={pxPerSecond}
            aria-label="Píxeles por segundo"
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <button
            type="button"
            className="button button--inline"
            aria-label="Acercar"
            onClick={() => setZoom(pxPerSecond + 20)}
            disabled={pxPerSecond >= MAX_PX_PER_SECOND}
          >
            +
          </button>
          <span className="muted reel-nle__zoom-label">{pxPerSecond} px/s</span>
        </div>
        <span className="muted reel-nle__strip-hint">
          Arrastra clips, bordes o transiciones
        </span>
        {onApplyTransition && (
          <div className="reel-nle__fx-tray" aria-label="Transiciones">
            <span className="muted">Transiciones</span>
            {TRANSITION_OPTIONS.map((option) => (
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
        )}
      </div>

      <div className="reel-nle__strip-body">
        <div className="reel-nle__label-col" aria-hidden="true">
          <span className="reel-nle__track-label reel-nle__track-label--spacer" />
          <span className="reel-nle__track-label" title="Video">
            Video
          </span>
          <span className="reel-nle__track-label" title="Superposiciones">
            Overlays
          </span>
          <span className="reel-nle__track-label" title="Subtítulos">
            Subs
          </span>
          <span className="reel-nle__track-label" title="Música">
            Música
          </span>
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
            onDrop={handleSurfaceDrop}
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

            <div className="reel-nle__track reel-nle__track--video" aria-label="Pista de video">
              {sourceGaps.map((gap) => {
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
              {spans.map((span) => {
                const segment = segments[span.index];
                const selected = segment.id === selectedSegmentId;
                return (
                    <div
                    key={span.id}
                    draggable={Boolean(onReorderSegments)}
                    className={`reel-nle__clip${span.index % 2 === 1 ? ' reel-nle__clip--alt' : ''}${
                      selected ? ' reel-nle__clip--selected' : ''
                    }${reorderOverId === segment.id ? ' reel-nle__clip--drop-target' : ''}`}
                    style={{
                      left: `calc(${span.leftRatio * 100}% + 3px)`,
                      width: `calc(${Math.max(span.widthRatio * 100, 0.8)}% - 6px)`,
                    }}
                    title={`Fragmento ${span.index + 1} · ${formatTimecode(segment.source_start_seconds)}–${formatTimecode(segment.source_end_seconds)}`}
                    onDragStart={(event) => handleClipDragStart(event, segment.id)}
                    onDragOver={(event) => handleClipDragOver(event, segment.id)}
                    onDrop={(event) => handleClipDrop(event, segment.id)}
                    onDragEnd={() => {
                      reorderDragIdRef.current = null;
                      setReorderOverId(null);
                    }}
                    onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest('.reel-nle__trim')) return;
                      event.stopPropagation();
                      onSelectGap?.(null);
                      onSelectSegment(segment.id, 'video');
                    }}
                  >
                    <span className="reel-nle__clip-label">
                      {span.index + 1} · {formatDuration(span.duration)}
                    </span>
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

              {spans.slice(0, -1).map((span) => {
                const segment = segments[span.index];
                const nextSpan = spans[span.index + 1];
                if (!segment || !nextSpan || !onApplyTransition) return null;
                const joinLeft = nextSpan.leftRatio * 100;
                const dragActive = transitionDragOverId === segment.id;
                return (
                  <button
                    key={`join-${segment.id}`}
                    type="button"
                    className={`reel-nle__join${dragActive ? ' reel-nle__join--dragover' : ''}`}
                    style={{ left: `${joinLeft}%` }}
                    title="Suelta aquí una transición (arrastra desde la bandeja o un diamante)"
                    aria-label={`Transición después del clip ${span.index + 1}`}
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
                if (!segment) return null;
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
            </div>

            <div
              className="reel-nle__track reel-nle__track--overlays"
              aria-label="Pista de superposiciones"
              onDoubleClick={(event) => {
                if (!onAddTextOverlay || !surfaceRef.current) return;
                event.stopPropagation();
                const output = timeFromClientX(
                  event.clientX,
                  surfaceRef.current,
                  totalDuration,
                  pxPerSecond,
                );
                onAddTextOverlay(output);
              }}
            >
              {overlays.length === 0 ? (
                <span className="reel-nle__track-empty muted">Sin overlays · doble clic = texto · suelta B-roll</span>
              ) : (
                overlays.map((overlay) => {
                  const startSec = overlay.start_ms / 1000;
                  const durSec = Math.max(0.2, overlay.duration_ms / 1000);
                  const left = totalDuration > 0 ? (startSec / totalDuration) * 100 : 0;
                  const width =
                    totalDuration > 0 ? Math.max((durSec / totalDuration) * 100, 0.8) : 0.8;
                  const selected = overlay.id === selectedOverlayId;
                  return (
                    <div
                      key={overlay.id}
                      role="presentation"
                      className={`reel-nle__clip reel-nle__clip--overlay${
                        selected ? ' reel-nle__clip--selected' : ''
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={
                        overlay.kind === 'text'
                          ? overlay.text || 'Texto'
                          : overlay.kind === 'video'
                            ? `B-roll · ${formatDuration(durSec)}`
                            : `Imagen · ${formatDuration(durSec)}`
                      }
                      onPointerDown={(event) => beginOverlayDrag(event, overlay)}
                    >
                      <span className="reel-nle__clip-label">
                        {overlay.kind === 'text'
                          ? (overlay.text || 'Texto').slice(0, 24)
                          : overlay.kind === 'video'
                            ? 'B-roll'
                            : 'Imagen'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="reel-nle__track reel-nle__track--captions" aria-label="Pista de subtítulos">
              {spans.map((span) => {
                const segment = segments[span.index];
                const selected = segment.id === selectedSegmentId;
                const label = (captionLabels[segment.id] ?? '').trim();
                const startSec =
                  segment.caption_in_ms != null ? segment.caption_in_ms / 1000 : span.start;
                const endSec =
                  segment.caption_out_ms != null
                    ? segment.caption_out_ms / 1000
                    : span.start + span.duration;
                const durSec = Math.max(0.2, endSec - startSec);
                const left = totalDuration > 0 ? (startSec / totalDuration) * 100 : 0;
                const width =
                  totalDuration > 0 ? Math.max((durSec / totalDuration) * 100, 0.8) : 0.8;
                return (
                  <div
                    key={`cc-${span.id}`}
                    role="presentation"
                    className={`reel-nle__clip reel-nle__clip--caption${selected ? ' reel-nle__clip--selected' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={label || `Subtítulos · fragmento ${span.index + 1}`}
                    onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest('.reel-nle__trim')) return;
                      event.stopPropagation();
                      onSelectSegment(segment.id, 'captions');
                      beginCaptionDrag(event, segment, span.start, span.duration, 'move');
                    }}
                  >
                    <span className="reel-nle__clip-label">
                      {label ? label.slice(0, 28) : '—'}
                    </span>
                    {onMoveCaption && (
                      <>
                        <button
                          type="button"
                          className="reel-nle__trim reel-nle__trim--start"
                          aria-label="Recortar inicio del subtítulo"
                          onPointerDown={(event) =>
                            beginCaptionDrag(event, segment, span.start, span.duration, 'start')
                          }
                        />
                        <button
                          type="button"
                          className="reel-nle__trim reel-nle__trim--end"
                          aria-label="Recortar fin del subtítulo"
                          onPointerDown={(event) =>
                            beginCaptionDrag(event, segment, span.start, span.duration, 'end')
                          }
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div
              className="reel-nle__track reel-nle__track--music"
              aria-label="Pista de música"
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectMusic?.();
                beginScrub(event);
              }}
            >
              {musicActive ? (
                <div
                  className="reel-nle__clip reel-nle__clip--music reel-nle__clip--selected"
                  style={{ left: '0%', width: '100%' }}
                  title={musicLabel}
                >
                  <span className="reel-nle__clip-label">{musicLabel}</span>
                </div>
              ) : (
                <span className="reel-nle__track-empty muted">Sin música de fondo</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
