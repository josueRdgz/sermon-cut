import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';

import { assetMediaSrc } from '../api/assets';
import type { ReelOverlay } from '../types/overlay';

interface OverlayPreviewLayerProps {
  overlays: ReelOverlay[];
  outputTime: number;
  previewing?: boolean;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (overlayId: string) => void;
  onMoveOverlay?: (overlayId: string, x: number, y: number) => void;
}

function isActive(overlay: ReelOverlay, outputTime: number): boolean {
  const start = overlay.start_ms / 1000;
  const end = start + Math.max(0, overlay.duration_ms) / 1000;
  return outputTime >= start && outputTime < end;
}

function OverlayVideoItem({
  overlay,
  style,
  outputTime,
  previewing,
  selected,
  onSelect,
  onMove,
}: {
  overlay: ReelOverlay;
  style: CSSProperties;
  outputTime: number;
  previewing: boolean;
  selected: boolean;
  onSelect?: (overlayId: string) => void;
  onMove?: (overlayId: string, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const localTime = Math.max(0, outputTime - overlay.start_ms / 1000);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (Math.abs(el.currentTime - localTime) > 0.25) {
      el.currentTime = localTime;
    }
    if (previewing) {
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [localTime, previewing]);

  if (!overlay.asset_media_url) return null;

  return (
    <video
      ref={ref}
      className={`reel-nle__overlay-item reel-nle__overlay-item--video${
        selected ? ' reel-nle__overlay-item--selected' : ''
      }`}
      src={assetMediaSrc(overlay.asset_media_url)}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      style={style}
      onPointerDown={(event) => beginOverlayDrag(event, overlay, onSelect, onMove)}
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
  event.currentTarget.setPointerCapture(event.pointerId);

  function pointToNorm(clientX: number, clientY: number) {
    const rect = bounds.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }

  function onPointerMove(move: globalThis.PointerEvent) {
    const next = pointToNorm(move.clientX, move.clientY);
    if (next) moveOverlay(overlay.id, next.x, next.y);
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
  const start = pointToNorm(event.clientX, event.clientY);
  if (start) moveOverlay(overlay.id, start.x, start.y);
}

export function OverlayPreviewLayer({
  overlays,
  outputTime,
  previewing = false,
  selectedOverlayId = null,
  onSelectOverlay,
  onMoveOverlay,
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

        if (overlay.kind === 'video' && overlay.asset_media_url) {
          return (
            <OverlayVideoItem
              key={overlay.id}
              overlay={overlay}
              style={style}
              outputTime={outputTime}
              previewing={previewing}
              selected={selected}
              onSelect={onSelectOverlay}
              onMove={onMoveOverlay}
            />
          );
        }

        if (overlay.kind === 'image' && overlay.asset_media_url) {
          return (
            <img
              key={overlay.id}
              className={`reel-nle__overlay-item reel-nle__overlay-item--image${
                selected ? ' reel-nle__overlay-item--selected' : ''
              }`}
              src={assetMediaSrc(overlay.asset_media_url)}
              alt=""
              style={style}
              onPointerDown={(event) =>
                beginOverlayDrag(event, overlay, onSelectOverlay, onMoveOverlay)
              }
            />
          );
        }

        if (overlay.kind === 'text') {
          return (
            <div
              key={overlay.id}
              className={`reel-nle__overlay-item reel-nle__overlay-item--text${
                selected ? ' reel-nle__overlay-item--selected' : ''
              }`}
              style={style}
              onPointerDown={(event) =>
                beginOverlayDrag(event, overlay, onSelectOverlay, onMoveOverlay)
              }
            >
              {overlay.text || 'Texto'}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
