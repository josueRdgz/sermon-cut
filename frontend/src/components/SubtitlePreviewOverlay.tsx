import { useCallback, useRef, type PointerEvent, type WheelEvent } from 'react';

import type { SubtitlePosition, SubtitleStyle } from '../types/reel';

export interface SubtitleLayoutPatch {
  subtitle_margin_bottom?: number;
  subtitle_font_size?: number;
  subtitle_position?: SubtitlePosition;
  subtitle_x?: number | null;
  subtitle_y?: number | null;
}

interface SubtitlePreviewOverlayProps {
  text: string;
  style: SubtitleStyle;
  position: SubtitlePosition;
  fontSize: number;
  opacity: number;
  marginBottom: number;
  uppercase: boolean;
  fontFamily?: string | null;
  posX?: number | null;
  posY?: number | null;
  interactive: boolean;
  onLayoutChange: (patch: SubtitleLayoutPatch) => void;
}

const MARGIN_MIN = 40;
const MARGIN_MAX = 500;
const FONT_MIN = 24;
const FONT_MAX = 120;

function marginToBottomPercent(marginBottom: number): number {
  const ratio = (marginBottom - MARGIN_MIN) / (MARGIN_MAX - MARGIN_MIN);
  return 4 + Math.max(0, Math.min(1, ratio)) * 32;
}

function bottomPercentToMargin(bottomPercent: number): number {
  const ratio = Math.max(0, Math.min(1, (bottomPercent - 4) / 32));
  return Math.round(MARGIN_MIN + ratio * (MARGIN_MAX - MARGIN_MIN));
}

function fallbackPos(position: SubtitlePosition): { x: number; y: number } {
  if (position === 'top') return { x: 0.5, y: 0.12 };
  if (position === 'center') return { x: 0.5, y: 0.5 };
  return { x: 0.5, y: 0.88 };
}

export function SubtitlePreviewOverlay({
  text,
  style,
  position,
  fontSize,
  opacity,
  uppercase,
  fontFamily,
  posX,
  posY,
  interactive,
  onLayoutChange,
}: SubtitlePreviewOverlayProps) {
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );
  const free = posX != null && posY != null;
  const origin = free ? { x: posX, y: posY } : fallbackPos(position);

  const styleClass = `subtitle-overlay subtitle-overlay--${style} subtitle-overlay--on-player subtitle-overlay--${position}${
    interactive ? ' subtitle-overlay--interactive' : ''
  }${free ? ' subtitle-overlay--free' : ''}`;

  const beginDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!interactive || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: origin.x,
        originY: origin.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [interactive, origin.x, origin.y],
  );

  const moveDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const stage = event.currentTarget.closest('.reel-player__stage');
      if (!(stage instanceof HTMLElement)) return;
      const rect = stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = Math.max(
        0.08,
        Math.min(0.92, dragRef.current.originX + (event.clientX - dragRef.current.startX) / rect.width),
      );
      const y = Math.max(
        0.1,
        Math.min(0.84, dragRef.current.originY + (event.clientY - dragRef.current.startY) / rect.height),
      );
      onLayoutChange({
        subtitle_x: x,
        subtitle_y: y,
        subtitle_position: y < 0.33 ? 'top' : y > 0.66 ? 'bottom' : 'center',
        subtitle_margin_bottom: bottomPercentToMargin((1 - y) * 36),
      });
    },
    [onLayoutChange],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  const onWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!interactive || !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY > 0 ? -2 : 2;
      const nextSize = Math.max(FONT_MIN, Math.min(FONT_MAX, fontSize + delta));
      if (nextSize !== fontSize) {
        onLayoutChange({ subtitle_font_size: nextSize });
      }
    },
    [fontSize, interactive, onLayoutChange],
  );

  return (
    <div
      className={styleClass}
      style={{
        position: 'absolute',
        left: `${origin.x * 100}%`,
        top: `${origin.y * 100}%`,
        bottom: 'auto',
        transform: 'translate(-50%, -50%)',
        fontSize: `min(6.5cqh, ${Math.max(10, fontSize * 0.022 * 100)}cqh)`,
        fontFamily: fontFamily ? `"${fontFamily}", sans-serif` : undefined,
        opacity,
        paddingBottom: 0,
        margin: 0,
        width: 'max-content',
        maxWidth: '92%',
        textTransform: uppercase ? 'uppercase' : 'none',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
      title={
        interactive
          ? 'Arrastra para colocar en cualquier sitio · Alt + rueda para cambiar tamaño'
          : undefined
      }
    >
      {interactive && <span className="subtitle-overlay__handle" aria-hidden />}
      <span className="subtitle-overlay__text">{text}</span>
    </div>
  );
}

export { bottomPercentToMargin, marginToBottomPercent, MARGIN_MAX, MARGIN_MIN, FONT_MAX, FONT_MIN };
