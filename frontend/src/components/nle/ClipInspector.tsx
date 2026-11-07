import type { CutSuggestion } from '../../types/cutSuggestions';
import type { ReelSegment, TransitionType } from '../../types/reel';
import { formatDuration, formatTimecode } from '../../utils/format';
import { CutSuggestionMarkers } from '../CutSuggestionsPanel';
import {
  ADJUST_STEPS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  sourceGapSeconds,
  TRANSITION_OPTIONS,
} from './clipConstants';

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
  canRemove?: boolean;
  removeTitle?: string;
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
  canRemove = true,
  removeTitle,
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
            className="button button--secondary button--inline"
            disabled={busy || index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="button button--secondary button--inline"
            disabled={busy || index === total - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="button button--danger button--inline"
            onClick={onRemove}
            disabled={busy || !canRemove}
            title={removeTitle}
          >
            Quitar
          </button>
        </div>
      </div>

      <div className="reel-segment-edit reel-segment-edit--roomy">
        <TrimRow
          label="Inicio"
          value={segment.source_start_seconds}
          disabled={busy}
          onCommit={(next) => onField({ source_start_seconds: next })}
          onAdjust={(delta) => onAdjustEdge('start', delta)}
        />
        <TrimRow
          label="Fin"
          value={segment.source_end_seconds}
          disabled={busy}
          onCommit={(next) => onField({ source_end_seconds: next })}
          onAdjust={(delta) => onAdjustEdge('end', delta)}
        />
        <p className="muted">
          {nextSegment
            ? segment.transition_type === 'hard_cut'
              ? 'Arrastra un efecto desde Transiciones y suéltalo en este corte.'
              : `Transición: ${
                  TRANSITION_OPTIONS.find((option) => option.value === segment.transition_type)
                    ?.label ?? segment.transition_type
                }. Arrastra otra para reemplazarla.`
            : 'No hay clip siguiente para una transición.'}
        </p>
        {segment.transition_type !== 'hard_cut' && (
          <label className="field field--inline">
            <span>Duración (ms)</span>
            <input
              type="number"
              min={MIN_TRANSITION_MS}
              max={MAX_TRANSITION_MS}
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

function TrimRow({
  label,
  value,
  disabled,
  onCommit,
  onAdjust,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (next: number) => void;
  onAdjust: (delta: number) => void;
}) {
  const negatives = ADJUST_STEPS.filter((step) => step < 0);
  const positives = ADJUST_STEPS.filter((step) => step > 0);
  return (
    <div className="reel-adjust">
      <span>{label}</span>
      {negatives.map((step) => (
        <button
          key={step}
          type="button"
          className="button button--secondary button--inline reel-adjust__step"
          disabled={disabled}
          onClick={() => onAdjust(step)}
        >
          {step}s
        </button>
      ))}
      <input
        type="number"
        step="0.01"
        defaultValue={value}
        key={`${label}-${value}`}
        aria-label={label}
        disabled={disabled}
        onBlur={(event) => {
          const nextVal = Number(event.target.value);
          if (Number.isFinite(nextVal) && nextVal !== value) onCommit(nextVal);
        }}
      />
      {positives.map((step) => (
        <button
          key={step}
          type="button"
          className="button button--secondary button--inline reel-adjust__step"
          disabled={disabled}
          onClick={() => onAdjust(step)}
        >
          +{step}s
        </button>
      ))}
    </div>
  );
}
