import type { CSSProperties } from 'react';

import { assetMediaSrc } from '../api/assets';
import type { ReelOverlay } from '../types/overlay';

interface OverlayPreviewLayerProps {
  overlays: ReelOverlay[];
  outputTime: number;
}

function isActive(overlay: ReelOverlay, outputTime: number): boolean {
  const start = overlay.start_ms / 1000;
  const end = start + Math.max(0, overlay.duration_ms) / 1000;
  return outputTime >= start && outputTime < end;
}

export function OverlayPreviewLayer({ overlays, outputTime }: OverlayPreviewLayerProps) {
  const active = overlays
    .filter((overlay) => isActive(overlay, outputTime))
    .sort((a, b) => a.z_index - b.z_index || a.order - b.order);

  if (active.length === 0) return null;

  return (
    <div className="reel-nle__overlay-layer" aria-hidden="true">
      {active.map((overlay) => {
        const style: CSSProperties = {
          left: `${overlay.x * 100}%`,
          top: `${overlay.y * 100}%`,
          opacity: overlay.opacity,
          transform: `translate(-50%, -50%) scale(${overlay.scale})`,
          zIndex: overlay.z_index,
        };

        if (overlay.kind === 'image' && overlay.asset_media_url) {
          return (
            <img
              key={overlay.id}
              className="reel-nle__overlay-item reel-nle__overlay-item--image"
              src={assetMediaSrc(overlay.asset_media_url)}
              alt=""
              style={style}
            />
          );
        }

        if (overlay.kind === 'text') {
          return (
            <div
              key={overlay.id}
              className="reel-nle__overlay-item reel-nle__overlay-item--text"
              style={style}
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
