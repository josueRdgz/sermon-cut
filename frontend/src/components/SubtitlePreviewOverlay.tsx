import { useCallback, useRef, type PointerEvent, type WheelEvent } from 'react';

import type { SubtitlePosition, SubtitleStyle } from '../types/reel';

export interface SubtitleLayoutPatch {
  subtitle_margin_bottom?: number;
  subtitle_font_size?: number;
  subtitle_position?: SubtitlePosition;
}

interface SubtitlePreviewOverlayProps {
  text: string;
  style: SubtitleStyle;
  position: SubtitlePosition;
  fontSize: number;
  opacity: number;
  marginBottom: number;
  uppercase: boolean;
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

export function SubtitlePreviewOverlay({
  text,
  style,
  position,
  fontSize,
  opacity,
  marginBottom,
  uppercase,
  interactive,
  onLayoutChange,
}: SubtitlePreviewOverlayProps) {
  const dragRef = useRef<{ startY: number; startMargin: number } | null>(null);

  const styleClass = `subtitle-overlay subtitle-overlay--${style} subtitle-overlay--on-player subtitle-overlay--${position}${
    interactive ? ' subtitle-overlay--interactive' : ''
  }`;

  const beginDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!interactive || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { startY: event.clientY, startMargin: marginBottom };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [interactive, marginBottom],
  );

  const moveDrag = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const stage = event.currentTarget.closest('.reel-player__stage');
      if (!(stage instanceof HTMLElement)) return;
      const rect = stage.getBoundingClientRect();
      if (rect.height <= 0) return;
      const deltaY = dragRef.current.startY - event.clientY;
      const deltaMargin = (deltaY / rect.height) * (MARGIN_MAX - MARGIN_MIN);
      const nextMargin = Math.round(
        Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, dragRef.current.startMargin + deltaMargin)),
      );
      onLayoutChange({
        subtitle_margin_bottom: nextMargin,
        subtitle_position: 'bottom',
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
        left: '50%',
        bottom: `${marginToBottomPercent(marginBottom)}%`,
        transform: 'translateX(-50%)',
        fontSize: `min(6.5cqh, ${Math.max(10, fontSize * 0.022 * 100)}cqh)`,
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
          ? 'Arrastra para mover · Alt + rueda para cambiar tamaño'
          : undefined
      }
    >
      {interactive && <span className="subtitle-overlay__handle" aria-hidden />}
      <span className="subtitle-overlay__text">{text}</span>
    </div>
  );
}

export { bottomPercentToMargin, marginToBottomPercent, MARGIN_MAX, MARGIN_MIN, FONT_MAX, FONT_MIN };
