import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { ApiError } from '../api/client';
import { updateReel } from '../api/reels';
import { getSubtitlePreview, listSubtitleTemplates } from '../api/subtitles';
import type { Reel, SubtitleGranularity, SubtitlePosition, SubtitleStyle } from '../types/reel';
import type { SubtitleCuePreview, SubtitlePreview, SubtitleTemplateInfo } from '../types/subtitle';

interface SubtitlePanelProps {
  projectId: string;
  reel: Reel;
  /** Current source-clock time from the video element (logical preview). */
  sourceTime: number | null;
  /** Index of the reel segment currently playing in the logical preview. */
  previewSegmentIndex: number | null;
  onReelUpdated: (reel: Reel) => void;
  /** Hide the duplicate gradient stage when the main player already shows cues. */
  hideStagePreview?: boolean;
}

const GRANULARITY_OPTIONS: { value: SubtitleGranularity; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'segment', label: 'Por segmento' },
  { value: 'phrase', label: 'Por frase' },
  { value: 'word', label: 'Por palabra' },
];

const POSITION_OPTIONS: { value: SubtitlePosition; label: string }[] = [
  { value: 'bottom', label: 'Inferior' },
  { value: 'center', label: 'Centro' },
  { value: 'top', label: 'Superior' },
];

function sourceToOutput(reel: Reel, segmentIndex: number, sourceTime: number): number | null {
  const ordered = [...reel.segments].sort((a, b) => a.order - b.order);
  if (segmentIndex < 0 || segmentIndex >= ordered.length) return null;

  let total = 0;
  let outputStart = 0;

  for (let i = 0; i < ordered.length; i += 1) {
    const seg = ordered[i];
    const duration = seg.source_end_seconds - seg.source_start_seconds;

    if (i === segmentIndex) {
      const local = Math.max(0, Math.min(sourceTime - seg.source_start_seconds, duration));
      return outputStart + local;
    }

    if (i === 0) {
      total = duration;
    } else {
      const prev = ordered[i - 1];
      let usable = 0;
      if (prev.transition_type !== 'hard_cut') {
        usable = Math.min(prev.transition_duration_ms / 1000, total - 0.05, duration - 0.05);
        if (usable < 0) usable = 0;
      }
      total += duration - usable;
    }

    if (i + 1 < ordered.length) {
      const next = ordered[i + 1];
      const nextDur = next.source_end_seconds - next.source_start_seconds;
      let usable = 0;
      if (seg.transition_type !== 'hard_cut') {
        usable = Math.min(seg.transition_duration_ms / 1000, total - 0.05, nextDur - 0.05);
        if (usable < 0) usable = 0;
      }
      outputStart = usable > 0 ? total - usable : total;
    }
  }
  return null;
}

function activeCue(
  preview: SubtitlePreview | null,
  outputTime: number | null,
): SubtitleCuePreview | null {
  if (!preview || outputTime == null) return null;
  return preview.cues.find((cue) => outputTime >= cue.start && outputTime < cue.end) ?? null;
}

function highlightedText(cue: SubtitleCuePreview, outputTime: number): string {
  if (!cue.highlight || cue.words.length === 0) return cue.text;
  return cue.words
    .map((word) => {
      const live = outputTime >= word.start && outputTime < word.end;
      return live ? `«${word.text}»` : word.text;
    })
    .join(' ');
}

export function SubtitlePanel({
  projectId,
  reel,
  sourceTime,
  previewSegmentIndex,
  onReelUpdated,
  hideStagePreview = false,
}: SubtitlePanelProps) {
  const [templates, setTemplates] = useState<SubtitleTemplateInfo[]>([]);
  const [preview, setPreview] = useState<SubtitlePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    try {
      setPreview(await getSubtitlePreview(projectId, reel.id));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa');
      }
    }
  }, [projectId, reel.id]);

  useEffect(() => {
    listSubtitleTemplates()
      .then((data) => setTemplates(data.items))
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    void loadPreview();
  }, [
    loadPreview,
    reel.subtitle_style,
    reel.subtitle_enabled,
    reel.subtitle_granularity,
    reel.subtitle_font_size,
    reel.subtitle_max_words,
    reel.subtitle_uppercase,
    reel.subtitle_bible_reference,
    reel.updated_at,
    // Reload when any per-cut caption changes (fragment subtitle edits).
    reel.segments.map((segment) => `${segment.id}:${segment.transcript_text ?? ''}`).join('|'),
  ]);

  const patch = useCallback(
    async (payload: Parameters<typeof updateReel>[2]) => {
      setBusy(true);
      setError(null);
      try {
        const updated = await updateReel(projectId, reel.id, payload);
        onReelUpdated(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar');
      } finally {
        setBusy(false);
      }
    },
    [projectId, reel.id, onReelUpdated],
  );

  const outputTime = useMemo(() => {
    if (sourceTime == null || previewSegmentIndex == null) return null;
    return sourceToOutput(reel, previewSegmentIndex, sourceTime);
  }, [reel, sourceTime, previewSegmentIndex]);

  const cue = activeCue(preview, outputTime);
  const liveCueText =
    cue && outputTime != null ? highlightedText(cue, outputTime) : null;
  const sample = preview?.cues[0]?.text ?? 'Así dice el Señor: buscadme y viviréis.';
  const stageText = liveCueText ?? sample;

  const styleClass = `subtitle-overlay subtitle-overlay--${reel.subtitle_style} subtitle-overlay--${reel.subtitle_position}`;
  const overlayHost =
    typeof document !== 'undefined' ? document.getElementById('reel-subtitle-overlay') : null;

  // Only paint on the player while a cue is active — never fall back to the
  // first caption or a sample phrase during silence / between fragments.
  const overlayNode =
    reel.subtitle_enabled && liveCueText ? (
      <div
        className={`${styleClass} subtitle-overlay--on-player`}
        style={{
          fontSize: `${Math.round(reel.subtitle_font_size * 0.35)}px`,
          opacity: reel.subtitle_opacity,
          paddingBottom: `${Math.round(reel.subtitle_margin_bottom * 0.2)}px`,
          textTransform: reel.subtitle_uppercase ? 'uppercase' : 'none',
        }}
      >
        <span className="subtitle-overlay__text">{liveCueText}</span>
      </div>
    ) : null;

  return (
    <div className="subtitle-panel">
      {overlayHost && overlayNode ? createPortal(overlayNode, overlayHost) : null}
      <div className="reel-editor__section-header">
        <h4>Subtítulos incrustados (ASS)</h4>
        <label className="field field--inline field--checkbox">
          <input
            type="checkbox"
            checked={reel.subtitle_enabled}
            disabled={busy}
            onChange={(e) => void patch({ subtitle_enabled: e.target.checked })}
          />
          <span>Incluir en el render</span>
        </label>
      </div>

      <p className="muted">
        Los tiempos se recalculan sobre la línea temporal final del Reel (no se conservan los del
        video original). Fuentes del sistema únicamente — sin descargas.
      </p>

      <div className="transcript-toolbar">
        <label className="field field--inline">
          <span>Estilo</span>
          <select
            value={reel.subtitle_style}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => {
              const style = e.target.value as SubtitleStyle;
              const template = templates.find((item) => item.id === style);
              void patch({
                subtitle_style: style,
                subtitle_font_size: template?.default_font_size,
                subtitle_max_words: template?.default_max_words,
                subtitle_uppercase: template?.default_uppercase,
                subtitle_margin_bottom: template?.default_margin_bottom,
                subtitle_granularity: template?.default_granularity,
              });
            }}
          >
            {(templates.length
              ? templates
              : [
                  { id: 'reformed_sober', label: 'Reformed sober' },
                  { id: 'modern_highlight', label: 'Modern highlight' },
                  { id: 'clear_reading', label: 'Clear reading' },
                  { id: 'sermon_quote', label: 'Sermon quote' },
                ]
            ).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span>Granularidad</span>
          <select
            value={reel.subtitle_granularity}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) =>
              void patch({ subtitle_granularity: e.target.value as SubtitleGranularity })
            }
          >
            {GRANULARITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span>Posición</span>
          <select
            value={reel.subtitle_position}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void patch({ subtitle_position: e.target.value as SubtitlePosition })}
          >
            {POSITION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="transcript-toolbar">
        <label className="field field--inline">
          <span>Tamaño</span>
          <input
            type="range"
            min={24}
            max={96}
            value={reel.subtitle_font_size}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void patch({ subtitle_font_size: Number(e.target.value) })}
          />
          <span className="muted">{reel.subtitle_font_size}px</span>
        </label>
        <label className="field field--inline">
          <span>Máx. palabras</span>
          <input
            type="number"
            min={1}
            max={24}
            value={reel.subtitle_max_words}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void patch({ subtitle_max_words: Number(e.target.value) })}
          />
        </label>
        <label className="field field--inline">
          <span>Opacidad</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={reel.subtitle_opacity}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void patch({ subtitle_opacity: Number(e.target.value) })}
          />
        </label>
        <label className="field field--inline">
          <span>Margen inferior</span>
          <input
            type="range"
            min={40}
            max={400}
            value={reel.subtitle_margin_bottom}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void patch({ subtitle_margin_bottom: Number(e.target.value) })}
          />
          <span className="muted">{reel.subtitle_margin_bottom}px</span>
        </label>
        <label className="field field--inline field--checkbox">
          <input
            type="checkbox"
            checked={reel.subtitle_uppercase}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void patch({ subtitle_uppercase: e.target.checked })}
          />
          <span>Mayúsculas</span>
        </label>
      </div>

      {reel.subtitle_style === 'sermon_quote' && (
        <label className="field">
          <span>Referencia bíblica (opcional)</span>
          <input
            type="text"
            value={reel.subtitle_bible_reference ?? ''}
            placeholder="p. ej. Juan 3:16"
            disabled={busy || !reel.subtitle_enabled}
            onBlur={(e) =>
              void patch({
                subtitle_bible_reference: e.target.value.trim() || null,
              })
            }
            onChange={(e) => onReelUpdated({ ...reel, subtitle_bible_reference: e.target.value })}
          />
        </label>
      )}

      {!hideStagePreview && (
        <div className="subtitle-preview-stage">
          <div
            className={styleClass}
            style={{
              fontSize: `${Math.round(reel.subtitle_font_size * 0.45)}px`,
              opacity: reel.subtitle_opacity,
              paddingBottom: `${Math.round(reel.subtitle_margin_bottom * 0.25)}px`,
              textTransform: reel.subtitle_uppercase ? 'uppercase' : 'none',
            }}
          >
            <span className="subtitle-overlay__text">{stageText}</span>
          </div>
          <p className="muted">
            Vista previa sobre el reproductor
            {preview ? ` · ${preview.cues.length} cue(s) · ${preview.granularity_used}` : ''}
            {outputTime != null ? ` · t=${outputTime.toFixed(2)}s (salida)` : ''}
          </p>
        </div>
      )}

      {hideStagePreview && (
        <p className="muted">
          Los subtítulos se muestran sobre la vista previa
          {preview ? ` · ${preview.cues.length} cue(s)` : ''}
          {outputTime != null ? ` · t=${outputTime.toFixed(2)}s` : ''}
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
