import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

import { assetMediaSrc } from '../api/assets';
import {
  clampOverlayScale,
  overlayKindLabel,
  overlaySourceWindow,
  overlayTextLabel,
  type ReelOverlay,
} from '../types/overlay';
import type { AspectRatio } from '../types/reel';
import { previewFontSizeCqh } from '../utils/previewTypography';
import {
  clampTextFontSize,
  parseTextOverlayStyle,
  textDecorationCss,
} from '../utils/textOverlayStyle';

interface OverlayPreviewLayerProps {
  overlays: ReelOverlay[];
  aspectRatio?: AspectRatio | null;
  outputTime: number;
  previewing?: boolean;
  previewMuted?: boolean;
  selectedOverlayId?: string | null;
  sourceVideoUrl?: string | null;
  onSelectOverlay?: (overlayId: string) => void;
  onMoveOverlay?: (overlayId: string, x: number, y: number) => void;
  onScaleOverlay?: (overlayId: string, scale: number) => void;
  onTextSizeOverlay?: (overlayId: string, fontSize: number) => void;
}

function isActive(overlay: ReelOverlay, outputTime: number): boolean {
  const start = overlay.start_ms / 1000;
  const end = start + Math.max(0, overlay.duration_ms) / 1000;
  return outputTime >= start && outputTime < end;
}

const DRIFT_SEC = 0.35;
const CLICK_SLOP_PX = 3;

function syncMediaTime(el: HTMLMediaElement, time: number) {
  if (!Number.isFinite(time) || time < 0) return;
  const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
  const clamped = duration != null ? Math.min(Math.max(0, time), Math.max(0, duration - 0.05)) : time;
  if (Math.abs(el.currentTime - clamped) > DRIFT_SEC) {
    el.currentTime = clamped;
  }
}

function OverlayVideoItem({
  overlay,
  outputTime,
  previewing,
  sourceVideoUrl,
}: {
  overlay: ReelOverlay;
  outputTime: number;
  previewing: boolean;
  sourceVideoUrl?: string | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const sourceWindow = overlaySourceWindow(overlay);
  const localTime = Math.max(0, outputTime - overlay.start_ms / 1000);
  const videoTime = (sourceWindow?.start ?? 0) + localTime;
  const videoTimeRef = useRef(videoTime);
  videoTimeRef.current = videoTime;
  const src = overlay.asset_media_url
    ? assetMediaSrc(overlay.asset_media_url)
    : sourceWindow
      ? sourceVideoUrl
      : null;

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    const sync = () => syncMediaTime(el, videoTimeRef.current);
    el.addEventListener('loadedmetadata', sync);
    sync();
    if (previewing) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
      sync();
    }
    const id = window.setInterval(sync, 250);
    return () => {
      el.removeEventListener('loadedmetadata', sync);
      window.clearInterval(id);
    };
  }, [previewing, src]);

  if (!src) return null;

  return (
    <video
      ref={ref}
      className="reel-nle__overlay-media"
      src={src}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
    />
  );
}

function beginOverlayDrag(
  event: PointerEvent<HTMLElement>,
  overlay: ReelOverlay,
  onSelect?: (overlayId: string) => void,
  onMove?: (overlayId: string, x: number, y: number) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  onSelect?.(overlay.id);
  if (!onMove) return;
  const layerEl = event.currentTarget.closest('.reel-nle__overlay-layer');
  if (!(layerEl instanceof HTMLElement)) return;
  const bounds = layerEl;
  const moveOverlay = onMove;
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  const originX = overlay.x;
  const originY = overlay.y;
  const startX = event.clientX;
  const startY = event.clientY;
  const layerRect = bounds.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  const halfW = Math.min(0.48, box.width / 2 / Math.max(1, layerRect.width));
  const halfH = Math.min(0.48, box.height / 2 / Math.max(1, layerRect.height));
  let dragging = false;
  target.setPointerCapture(pointerId);

  function apply(clientX: number, clientY: number) {
    const rect = bounds.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(halfW, Math.min(1 - halfW, originX + (clientX - startX) / rect.width));
    const y = Math.max(halfH, Math.min(1 - halfH, originY + (clientY - startY) / rect.height));
    moveOverlay(overlay.id, x, y);
  }

  function onPointerMove(move: globalThis.PointerEvent) {
    if (move.pointerId !== pointerId) return;
    if (!dragging) {
      const dx = move.clientX - startX;
      const dy = move.clientY - startY;
      if (dx * dx + dy * dy < CLICK_SLOP_PX * CLICK_SLOP_PX) return;
      dragging = true;
    }
    apply(move.clientX, move.clientY);
  }

  function onPointerUp(upEvent: globalThis.PointerEvent) {
    if (upEvent.pointerId !== pointerId) return;
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

const HANDLE_CORNERS = ['nw', 'ne', 'sw', 'se'] as const;

function beginOverlayScale(
  event: PointerEvent<HTMLElement>,
  overlay: ReelOverlay,
  onScale?: (overlayId: string, scale: number) => void,
  onTextSize?: (overlayId: string, fontSize: number) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  const layerEl = event.currentTarget.closest('.reel-nle__overlay-layer');
  if (!(layerEl instanceof HTMLElement)) return;
  const bounds = layerEl;
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  const origin = overlay.scale;
  const originFont = overlay.kind === 'text' ? parseTextOverlayStyle(overlay).font_size : null;
  const rect = bounds.getBoundingClientRect();
  const cx = rect.left + overlay.x * rect.width;
  const cy = rect.top + overlay.y * rect.height;
  const startDist = Math.hypot(event.clientX - cx, event.clientY - cy) || 1;
  target.setPointerCapture(pointerId);

  function apply(clientX: number, clientY: number) {
    const dist = Math.hypot(clientX - cx, clientY - cy);
    const factor = dist / startDist;
    if (originFont != null && onTextSize) {
      onTextSize(overlay.id, clampTextFontSize(originFont * factor));
      return;
    }
    if (onScale) onScale(overlay.id, clampOverlayScale(origin * factor));
  }

  function onPointerMove(move: globalThis.PointerEvent) {
    if (move.pointerId !== pointerId) return;
    apply(move.clientX, move.clientY);
  }

  function onPointerUp(upEvent: globalThis.PointerEvent) {
    if (upEvent.pointerId !== pointerId) return;
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function OverlayChrome({
  overlay,
  selected,
  style,
  className,
  onSelect,
  onMove,
  onScale,
  onTextSize,
  children,
}: {
  overlay: ReelOverlay;
  selected: boolean;
  style: CSSProperties;
  className: string;
  onSelect?: (overlayId: string) => void;
  onMove?: (overlayId: string, x: number, y: number) => void;
  onScale?: (overlayId: string, scale: number) => void;
  onTextSize?: (overlayId: string, fontSize: number) => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`reel-nle__overlay-item ${className}${selected ? ' reel-nle__overlay-item--selected' : ''}`}
      style={style}
      role="button"
      aria-label={
        overlay.kind === 'text' ? overlayTextLabel(overlay.text) : overlayKindLabel(overlay.kind)
      }
      onPointerDown={(event) => beginOverlayDrag(event, overlay, onSelect, onMove)}
      onWheel={
        onScale || onTextSize
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              const factor = event.deltaY < 0 ? 1.06 : 0.94;
              if (overlay.kind === 'text' && onTextSize) {
                onTextSize(
                  overlay.id,
                  clampTextFontSize(parseTextOverlayStyle(overlay).font_size * factor),
                );
                return;
              }
              if (onScale) onScale(overlay.id, clampOverlayScale(overlay.scale * factor));
            }
          : undefined
      }
    >
      {children}
      {selected && (onScale || onTextSize)
        ? HANDLE_CORNERS.map((corner) => (
            <span
              key={corner}
              className={`reel-nle__overlay-handle reel-nle__overlay-handle--${corner}`}
              role="slider"
              aria-label="Cambiar tamaño"
              onPointerDown={(event) => beginOverlayScale(event, overlay, onScale, onTextSize)}
            />
          ))
        : null}
    </div>
  );
}

function OverlayAudioItem({
  overlay,
  outputTime,
  previewing,
  muted,
}: {
  overlay: ReelOverlay;
  outputTime: number;
  previewing: boolean;
  muted: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const localTime = Math.max(0, outputTime - overlay.start_ms / 1000);
  const localTimeRef = useRef(localTime);
  localTimeRef.current = localTime;
  const src = overlay.asset_media_url ? assetMediaSrc(overlay.asset_media_url) : null;
  const gain = Math.max(0, Math.min(1, overlay.opacity));
  const shouldPlay = previewing && !muted && gain > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = gain;
    el.muted = muted || gain <= 0;
  }, [gain, muted]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src) return;
    const sync = () => syncMediaTime(el, localTimeRef.current);
    el.addEventListener('loadedmetadata', sync);
    sync();
    if (shouldPlay) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
      sync();
    }
    const id = window.setInterval(sync, 250);
    return () => {
      el.removeEventListener('loadedmetadata', sync);
      window.clearInterval(id);
    };
  }, [shouldPlay, src]);

  if (!src) return null;
  return <audio ref={ref} src={src} preload="auto" aria-hidden="true" />;
}

export function OverlayPreviewLayer({
  overlays,
  aspectRatio = '9:16',
  outputTime,
  previewing = false,
  previewMuted = false,
  selectedOverlayId = null,
  sourceVideoUrl = null,
  onSelectOverlay,
  onMoveOverlay,
  onScaleOverlay,
  onTextSizeOverlay,
}: OverlayPreviewLayerProps) {
  const active = overlays
    .filter((overlay) => isActive(overlay, outputTime))
    .sort((a, b) => a.z_index - b.z_index || a.order - b.order);

  if (active.length === 0) return null;

  return (
    <div className="reel-nle__overlay-layer">
      {active.map((overlay) => {
        const isText = overlay.kind === 'text';
        const selected = overlay.id === selectedOverlayId;
        const style: CSSProperties = {
          left: `${overlay.x * 100}%`,
          top: `${overlay.y * 100}%`,
          opacity: overlay.opacity,
          transform: isText
            ? `translate(-50%, -50%) scale(${overlay.scale})`
            : 'translate(-50%, -50%)',
          width: isText ? undefined : `${overlay.scale * 100}%`,
          zIndex: overlay.z_index,
        };

        if (overlay.kind === 'video' && (overlay.asset_media_url || overlaySourceWindow(overlay))) {
          return (
            <OverlayChrome
              key={overlay.id}
              overlay={overlay}
              selected={selected}
              style={style}
              className="reel-nle__overlay-item--video"
              onSelect={onSelectOverlay}
              onMove={onMoveOverlay}
              onScale={onScaleOverlay}
            >
              <OverlayVideoItem
                overlay={overlay}
                outputTime={outputTime}
                previewing={previewing}
                sourceVideoUrl={sourceVideoUrl}
              />
            </OverlayChrome>
          );
        }

        if (overlay.kind === 'image' && overlay.asset_media_url) {
          return (
            <OverlayChrome
              key={overlay.id}
              overlay={overlay}
              selected={selected}
              style={style}
              className="reel-nle__overlay-item--image"
              onSelect={onSelectOverlay}
              onMove={onMoveOverlay}
              onScale={onScaleOverlay}
            >
              <img className="reel-nle__overlay-media" src={assetMediaSrc(overlay.asset_media_url)} alt="" />
            </OverlayChrome>
          );
        }

        if (overlay.kind === 'audio') {
          return (
            <OverlayAudioItem
              key={overlay.id}
              overlay={overlay}
              outputTime={outputTime}
              previewing={previewing}
              muted={previewMuted}
            />
          );
        }

        if (overlay.kind === 'text') {
          const textStyle = parseTextOverlayStyle(overlay);
          return (
            <OverlayChrome
              key={overlay.id}
              overlay={overlay}
              selected={selected}
              style={{
                ...style,
                fontFamily: `"${textStyle.font_family}", sans-serif`,
                fontSize: previewFontSizeCqh(textStyle.font_size, aspectRatio),
                fontWeight: textStyle.bold ? 700 : 500,
                fontStyle: textStyle.italic ? 'italic' : 'normal',
                textDecoration: textDecorationCss(textStyle),
              }}
              className="reel-nle__overlay-item--text"
              onSelect={onSelectOverlay}
              onMove={onMoveOverlay}
              onTextSize={onTextSizeOverlay}
            >
              {overlayTextLabel(overlay.text)}
            </OverlayChrome>
          );
        }

        return null;
      })}
    </div>
  );
}
