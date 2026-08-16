import { overlayKindLabel, type ReelOverlay } from '../../types/overlay';
import { formatDuration } from '../../utils/format';

interface OverlayInspectorProps {
  overlay: ReelOverlay;
  busy: boolean;
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

export function OverlayInspector({ overlay, busy, onChange, onDelete }: OverlayInspectorProps) {
  return (
    <div className="reel-nle__selected-clip reel-nle__overlay-inspector">
      <div className="reel-nle__selected-clip-header">
        <div>
          <h4>Overlay {overlayKindLabel(overlay.kind)}</h4>
          <p className="muted">
            {formatDuration(overlay.start_ms / 1000)} · {formatDuration(overlay.duration_ms / 1000)}
            {' · '}
            arrastra en el visor
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
        {overlay.kind === 'text' && (
          <label className="field">
            <span>Texto</span>
            <textarea
              rows={3}
              value={overlay.text ?? ''}
              disabled={busy}
              onChange={(event) => onChange({ text: event.target.value })}
            />
          </label>
        )}
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
            min={0.1}
            max={4}
            step={0.05}
            value={overlay.scale}
            disabled={busy}
            onChange={(event) => onChange({ scale: Number(event.target.value) })}
          />
        </label>
        <label className="field field--inline">
          <span>Opacidad</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={overlay.opacity}
            disabled={busy}
            onChange={(event) => onChange({ opacity: Number(event.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}
