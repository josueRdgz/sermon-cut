import { useRef, type PointerEvent } from 'react';

interface NleSplitterProps {
  orientation?: 'vertical' | 'horizontal';
  label: string;
  onDrag: (deltaPx: number) => void;
}

export function NleSplitter({
  orientation = 'vertical',
  label,
  onDrag,
}: NleSplitterProps) {
  const last = useRef<number | null>(null);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    last.current = orientation === 'vertical' ? event.clientX : event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (last.current == null || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }
    const next = orientation === 'vertical' ? event.clientX : event.clientY;
    const delta = next - last.current;
    last.current = next;
    if (delta !== 0) onDrag(delta);
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    last.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <button
      type="button"
      className={`reel-nle__splitter reel-nle__splitter--${orientation}`}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
