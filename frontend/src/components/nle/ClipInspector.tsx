import type { CutSuggestion } from '../../types/cutSuggestions';
import type { ReelSegment, TransitionType } from '../../types/reel';
import { formatDuration, formatTimecode } from '../../utils/format';
import { CutSuggestionMarkers } from '../CutSuggestionsPanel';
import { ADJUST_STEPS, sourceGapSeconds, TRANSITION_OPTIONS } from './clipConstants';

interface ClipInspectorProps {
  segment: ReelSegment;
  index: number;
  total: number;
  nextSegment: ReelSegment | null;
  outputStart: number;
  outputDuration: number;
  busy: boolean;
  cutSuggestions: CutSuggestion[];
  cutBusy: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onAdjustEdge: (edge: 'start' | 'end', delta: number) => void;
  onField: (patch: {
    source_start_seconds?: number;
    source_end_seconds?: number;
    transition_type?: TransitionType;
    transition_duration_ms?: number;
  }) => void;
  onAcceptCut: (suggestion: CutSuggestion) => void;
  onRejectCut: (suggestion: CutSuggestion) => void;
  compact?: boolean;
}

export function ClipInspector({
  segment,
  index,
  total,
  nextSegment,
  outputStart,
  outputDuration,
  busy,
  cutSuggestions,
  cutBusy,
  onMove,
  onRemove,
  onAdjustEdge,
  onField,
  onAcceptCut,
  onRejectCut,
  compact = false,
}: ClipInspectorProps) {
  const gap = nextSegment
    ? sourceGapSeconds(segment.source_end_seconds, nextSegment.source_start_seconds)
    : null;
  const outputEnd = outputStart + outputDuration;

  return (
    <div
      className={`reel-nle__selected-clip reel-nle__selected-clip--roomy${
        compact ? ' reel-nle__selected-clip--compact' : ''
      }`}
    >
      {!compact && (
      <p className="muted">
        Selecciona el corte en la línea temporal. Ajusta segundos al inicio o al final. Los
        subtítulos se editan en Subtítulos; aquí solo se recorta el video.
      </p>
      )}
      <div className="reel-nle__selected-clip-header">
        <div>
          <h4>Fragmento {index + 1}</h4>
          <p className="muted">
            Fuente {formatTimecode(segment.source_start_seconds)} –{' '}
            {formatTimecode(segment.source_end_seconds)}
            {' · '}
            {formatDuration(segment.duration_seconds)}
            {gap != null && Math.abs(gap) > 0.05
              ? gap > 0
                ? ` · salto ${formatDuration(gap)}`
                : ` · solapa ${formatDuration(Math.abs(gap))}`
              : ''}
          </p>
          <p className="muted reel-nle__clip-clock">
            Programa {formatDuration(outputStart)} – {formatDuration(outputEnd)}
          </p>
        </div>
        <div className="button-stack">
          <button
            type="button"
            className="button button--inline"
            disabled={busy || index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="button button--inline"
            disabled={busy || index === total - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="button button--inline button--danger"
            onClick={onRemove}
            disabled={busy}
          >
            Quitar
          </button>
        </div>
      </div>

      <div className="reel-segment-edit reel-segment-edit--roomy">
        <div className="reel-adjust">
          <span>Inicio</span>
          <input
            type="number"
            step="0.01"
            defaultValue={segment.source_start_seconds}
            key={`start-${segment.id}-${segment.source_start_seconds}`}
            onBlur={(event) => {
              const nextVal = Number(event.target.value);
              if (Number.isFinite(nextVal) && nextVal !== segment.source_start_seconds) {
                onField({ source_start_seconds: nextVal });
              }
            }}
          />
          {ADJUST_STEPS.map((step) => (
            <button
              key={`start-${step}`}
              type="button"
              className="button button--inline"
              disabled={busy}
              onClick={() => onAdjustEdge('start', step)}
            >
              {step > 0 ? `+${step}` : step}s
            </button>
          ))}
        </div>
        <div className="reel-adjust">
          <span>Fin</span>
          <input
            type="number"
            step="0.01"
            defaultValue={segment.source_end_seconds}
            key={`end-${segment.id}-${segment.source_end_seconds}`}
            onBlur={(event) => {
              const nextVal = Number(event.target.value);
              if (Number.isFinite(nextVal) && nextVal !== segment.source_end_seconds) {
                onField({ source_end_seconds: nextVal });
              }
            }}
          />
          {ADJUST_STEPS.map((step) => (
            <button
              key={`end-${step}`}
              type="button"
              className="button button--inline"
              disabled={busy}
              onClick={() => onAdjustEdge('end', step)}
            >
              {step > 0 ? `+${step}` : step}s
            </button>
          ))}
        </div>
        <label className="field field--inline">
          <span>Transición al siguiente</span>
          <select
            value={segment.transition_type}
            disabled={busy || !nextSegment}
            onChange={(event) =>
              onField({ transition_type: event.target.value as TransitionType })
            }
          >
            {TRANSITION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {segment.transition_type !== 'hard_cut' && (
          <label className="field field--inline">
            <span>Duración (ms)</span>
            <input
              type="number"
              min={1}
              max={5000}
              value={segment.transition_duration_ms}
              disabled={busy || !nextSegment}
              onChange={(event) =>
                onField({ transition_duration_ms: Number(event.target.value) })
              }
            />
          </label>
        )}
      </div>

      {!compact && (
      <CutSuggestionMarkers
        suggestions={cutSuggestions}
        segmentUuid={segment.id}
        busy={cutBusy || busy}
        onAccept={onAcceptCut}
        onReject={onRejectCut}
      />
      )}
    </div>
  );
}
