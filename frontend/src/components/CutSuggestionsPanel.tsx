import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  acceptCutSuggestion,
  generateCutSuggestions,
  listCutSuggestions,
  rejectCutSuggestion,
} from '../api/cutSuggestions';
import type {
  CutIntensity,
  CutSuggestion,
  CutSuggestionsReport,
} from '../types/cutSuggestions';
import type { Reel } from '../types/reel';
import { formatDuration, formatTimecode } from '../utils/format';

interface CutSuggestionsPanelProps {
  projectId: string;
  reelId: string;
  segmentIds: string[];
  onReelChange: (reel: Reel) => void;
  onReportChange?: (report: CutSuggestionsReport | null) => void;
}

const INTENSITY_OPTIONS: { value: CutIntensity; label: string }[] = [
  { value: 'conservative', label: 'Conservadora (sermones)' },
  { value: 'balanced', label: 'Equilibrada' },
  { value: 'aggressive', label: 'Agresiva' },
];

const KIND_LABEL: Record<string, string> = {
  trim_leading_silence: 'Silencio inicial',
  trim_trailing_silence: 'Silencio final',
  reduce_internal_silence: 'Reducir silencio',
  long_pause: 'Pausa larga',
  filler_word: 'Muletilla',
  immediate_repetition: 'Repetición',
  false_start: 'Falso comienzo',
};

export function CutSuggestionsPanel({
  projectId,
  reelId,
  segmentIds,
  onReelChange,
  onReportChange,
}: CutSuggestionsPanelProps) {
  const [report, setReport] = useState<CutSuggestionsReport | null>(null);
  const [intensity, setIntensity] = useState<CutIntensity>('conservative');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(
    (next: CutSuggestionsReport | null) => {
      setReport(next);
      onReportChange?.(next);
    },
    [onReportChange],
  );

  const reload = useCallback(async () => {
    if (segmentIds.length === 0) {
      publish(null);
      return;
    }
    try {
      publish(await listCutSuggestions(projectId, reelId));
    } catch {
      publish(null);
    }
  }, [projectId, reelId, segmentIds.length, publish]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await generateCutSuggestions(projectId, reelId, {
        intensity,
        include_silence: true,
        include_fillers: true,
      });
      publish(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron generar sugerencias');
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async (suggestion: CutSuggestion) => {
    setBusy(true);
    setError(null);
    try {
      const result = await acceptCutSuggestion(projectId, reelId, suggestion.id);
      onReelChange(result.reel);
      publish(result.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar la sugerencia');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (suggestion: CutSuggestion) => {
    setBusy(true);
    setError(null);
    try {
      const result = await rejectCutSuggestion(projectId, reelId, suggestion.id);
      publish(result.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar la sugerencia');
    } finally {
      setBusy(false);
    }
  };

  const pending = useMemo(
    () => report?.suggestions.filter((item) => item.status === 'pending') ?? [],
    [report],
  );

  if (segmentIds.length === 0) {
    return null;
  }

  return (
    <div className="cut-suggestions">
      <div className="reel-editor__section-header">
        <h4>Cortes técnicos (opcionales)</h4>
        {report && (
          <span className="badge badge--cut">{report.pending_count} pendientes</span>
        )}
      </div>
      <p className="muted">
        Detecta silencios, pausas y posibles muletillas. Nada se aplica solo: acepta o rechaza
        cada sugerencia. Por defecto usa intensidad conservadora para no forzar la respiración
        del predicador.
      </p>
      <div className="transcript-toolbar">
        <label className="field field--inline">
          <span>Intensidad</span>
          <select
            value={intensity}
            disabled={busy}
            onChange={(e) => setIntensity(e.target.value as CutIntensity)}
          >
            {INTENSITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void handleGenerate()} disabled={busy}>
          {busy ? 'Analizando…' : 'Analizar cortes'}
        </button>
      </div>
      {report && <p className="muted">{report.summary}</p>}
      {pending.length > 0 && (
        <ul className="cut-suggestions__list">
          {pending.map((suggestion) => (
            <li key={suggestion.id} className="cut-suggestion">
              <div className="cut-suggestion__head">
                <span className="cut-suggestion__kind">
                  {KIND_LABEL[suggestion.kind] ?? suggestion.kind}
                </span>
                <span className="muted">Fragmento {suggestion.segment_id}</span>
                <span className="cut-suggestion__range">
                  {formatTimecode(suggestion.region_start)} –{' '}
                  {formatTimecode(suggestion.region_end)} (
                  {formatDuration(suggestion.region_end - suggestion.region_start)})
                </span>
                {suggestion.requires_review && (
                  <span className="badge badge--review">Revisar</span>
                )}
              </div>
              <p>{suggestion.message}</p>
              {suggestion.matched_text && (
                <p className="muted">Texto: «{suggestion.matched_text}»</p>
              )}
              <p className="muted">{suggestion.recommendation}</p>
              {suggestion.split && (
                <p className="muted">
                  Al aceptar: parte el fragmento + crossfade {suggestion.apply_crossfade_ms} ms
                  (margen ~{suggestion.keep_margin.toFixed(2)} s).
                </p>
              )}
              <div className="button-stack">
                <button type="button" onClick={() => void handleAccept(suggestion)} disabled={busy}>
                  Aceptar
                </button>
                <button
                  type="button"
                  className="button--ghost"
                  onClick={() => void handleReject(suggestion)}
                  disabled={busy}
                >
                  Rechazar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Inline markers for a single timeline fragment. */
export function CutSuggestionMarkers({
  suggestions,
  segmentUuid,
  onAccept,
  onReject,
  busy,
}: {
  suggestions: CutSuggestion[];
  segmentUuid: string;
  onAccept: (suggestion: CutSuggestion) => void;
  onReject: (suggestion: CutSuggestion) => void;
  busy: boolean;
}) {
  const items = suggestions.filter(
    (item) => item.segment_uuid === segmentUuid && item.status === 'pending',
  );
  if (items.length === 0) return null;
  return (
    <ul className="cut-markers">
      {items.map((suggestion) => (
        <li key={suggestion.id} className="cut-marker">
          <span className="cut-marker__label">
            {KIND_LABEL[suggestion.kind] ?? suggestion.kind} ·{' '}
            {formatTimecode(suggestion.region_start)}–
            {formatTimecode(suggestion.region_end)}
            {suggestion.requires_review ? ' · revisar' : ''}
          </span>
          <div className="button-stack">
            <button
              type="button"
              className="button button--inline"
              disabled={busy}
              onClick={() => onAccept(suggestion)}
            >
              Aceptar
            </button>
            <button
              type="button"
              className="button button--inline button--ghost"
              disabled={busy}
              onClick={() => onReject(suggestion)}
            >
              Rechazar
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
