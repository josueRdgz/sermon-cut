import {
  OVERLAY_SCALE_MAX,
  OVERLAY_SCALE_MIN,
  overlayKindLabel,
  overlayTextLabel,
  type ReelOverlay,
} from '../../types/overlay';
import { formatDuration } from '../../utils/format';

interface OverlayInspectorProps {
  overlay: ReelOverlay;
  busy: boolean;
  compact?: boolean;
  onChange: (patch: {
    text?: string | null;
    start_ms?: number;
    duration_ms?: number;
    scale?: number;
    opacity?: number;
    x?: number;
    y?: number;
  }) => void;
  onDelete: () => void;
}

export function OverlayInspector({
  overlay,
  busy,
  compact = false,
  onChange,
  onDelete,
}: OverlayInspectorProps) {
  const hint =
    overlay.kind === 'audio'
      ? 'el deslizador Música mueve el volumen'
      : 'arrastra en el visor · esquinas para el tamaño';
  return (
    <div
      className={`reel-nle__selected-clip reel-nle__overlay-inspector${
        compact ? ' reel-nle__selected-clip--compact' : ''
      }`}
    >
      <div className="reel-nle__selected-clip-header">
        <div>
          <h4>{overlayKindLabel(overlay.kind)}</h4>
          <p className="muted">
            {formatDuration(overlay.start_ms / 1000)} · {formatDuration(overlay.duration_ms / 1000)}
            {' · '}
            {hint}
          </p>
        </div>
        <button
          type="button"
          className="button button--inline button--danger"
          disabled={busy}
          onClick={onDelete}
        >
          Eliminar
        </button>
      </div>
      {overlay.kind === 'text' && (
        <label className="field">
          <span>Texto</span>
          <textarea
            rows={compact ? 2 : 3}
            value={overlayTextLabel(overlay.text, '')}
            disabled={busy}
            onChange={(event) => onChange({ text: event.target.value })}
          />
        </label>
      )}
      <div className="inspector-sliders">
        {overlay.kind !== 'audio' && (
          <label className="inspector-slider">
            <span>Tamaño</span>
            <input
              type="range"
              min={OVERLAY_SCALE_MIN}
              max={OVERLAY_SCALE_MAX}
              step={0.02}
              value={overlay.scale}
              disabled={busy}
              aria-label="Tamaño de la capa"
              onChange={(event) => onChange({ scale: Number(event.target.value) })}
            />
            <em>{Math.round(overlay.scale * 100)}%</em>
          </label>
        )}
        <label className="inspector-slider">
          <span>{overlay.kind === 'audio' ? 'Volumen' : 'Opacidad'}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={overlay.opacity}
            disabled={busy}
            aria-label={overlay.kind === 'audio' ? 'Volumen de la capa' : 'Opacidad de la capa'}
            onChange={(event) => onChange({ opacity: Number(event.target.value) })}
          />
          <em>{Math.round(overlay.opacity * 100)}%</em>
        </label>
      </div>
      {!compact && (
        <div className="reel-segment-edit reel-segment-edit--roomy">
          <label className="field field--inline">
            <span>Inicio (ms)</span>
            <input
              type="number"
              min={0}
              step={50}
              value={overlay.start_ms}
              disabled={busy}
              onChange={(event) => onChange({ start_ms: Number(event.target.value) })}
            />
          </label>
          <label className="field field--inline">
            <span>Duración (ms)</span>
            <input
              type="number"
              min={100}
              step={50}
              value={overlay.duration_ms}
              disabled={busy}
              onChange={(event) => onChange({ duration_ms: Number(event.target.value) })}
            />
          </label>
          {overlay.kind !== 'audio' && (
            <>
              <label className="field field--inline">
                <span>X</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Number(overlay.x.toFixed(2))}
                  disabled={busy}
                  onChange={(event) => onChange({ x: Number(event.target.value) })}
                />
              </label>
              <label className="field field--inline">
                <span>Y</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Number(overlay.y.toFixed(2))}
                  disabled={busy}
                  onChange={(event) => onChange({ y: Number(event.target.value) })}
                />
              </label>
              <label className="field field--inline">
                <span>Escala</span>
                <input
                  type="number"
                  min={OVERLAY_SCALE_MIN}
                  max={OVERLAY_SCALE_MAX}
                  step={0.02}
                  value={Number(overlay.scale.toFixed(2))}
                  disabled={busy}
                  onChange={(event) => onChange({ scale: Number(event.target.value) })}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
