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
  captionDraft: string;
  captionBaseline: string;
  captionSaving: boolean;
  busy: boolean;
  cutSuggestions: CutSuggestion[];
  cutBusy: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onCaptionChange: (value: string) => void;
  onCaptionCommit: (value: string) => void;
  onSaveCaption: () => void;
  onClearCaption: () => void;
  onOpenSubtitleStyle: () => void;
  onAdjustEdge: (edge: 'start' | 'end', delta: number) => void;
  onField: (patch: {
    source_start_seconds?: number;
    source_end_seconds?: number;
    transition_type?: TransitionType;
    transition_duration_ms?: number;
  }) => void;
  onAcceptCut: (suggestion: CutSuggestion) => void;
  onRejectCut: (suggestion: CutSuggestion) => void;
}

export function ClipInspector({
  segment,
  index,
  total,
  nextSegment,
  outputStart,
  outputDuration,
  captionDraft,
  captionBaseline,
  captionSaving,
  busy,
  cutSuggestions,
  cutBusy,
  onMove,
  onRemove,
  onCaptionChange,
  onCaptionCommit,
  onSaveCaption,
  onClearCaption,
  onOpenSubtitleStyle,
  onAdjustEdge,
  onField,
  onAcceptCut,
  onRejectCut,
}: ClipInspectorProps) {
  const gap = nextSegment
    ? sourceGapSeconds(segment.source_end_seconds, nextSegment.source_start_seconds)
    : null;
  const dirty = captionDraft !== captionBaseline;
  const hasCustom = Boolean(segment.transcript_text?.trim());
  const outputEnd = outputStart + outputDuration;

  return (
    <div className="reel-nle__selected-clip reel-nle__selected-clip--roomy">
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

      <div className="reel-transcript-form reel-transcript-form--editor">
        <p className="reel-transcript-form__label">Subtítulo de este fragmento</p>
        <textarea
          className="reel-transcript-form__input"
          rows={8}
          value={captionDraft}
          disabled={captionSaving || busy}
          placeholder="Texto que debe verse en este fragmento…"
          onChange={(event) => onCaptionChange(event.target.value)}
          onBlur={(event) => {
            const value = event.target.value;
            if (value.trim() && value !== captionBaseline) onCaptionCommit(value);
          }}
        />
        <div className="reel-transcript-form__actions">
          <button
            type="button"
            className="button"
            disabled={captionSaving || busy || !dirty || !captionDraft.trim()}
            onClick={onSaveCaption}
          >
            {captionSaving ? 'Guardando…' : dirty ? 'Guardar subtítulo' : 'Guardado'}
          </button>
          {hasCustom && (
            <button
              type="button"
              className="button button--secondary"
              disabled={captionSaving || busy}
              onClick={onClearCaption}
            >
              Texto del video
            </button>
          )}
          <button type="button" className="button button--secondary" onClick={onOpenSubtitleStyle}>
            Estilo de subtítulos
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

      <CutSuggestionMarkers
        suggestions={cutSuggestions}
        segmentUuid={segment.id}
        busy={cutBusy || busy}
        onAccept={onAcceptCut}
        onReject={onRejectCut}
      />
    </div>
  );
}
