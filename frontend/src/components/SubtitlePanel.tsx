import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ApiError } from '../api/client';
import { splitReelSegment, updateReel, updateReelSegment } from '../api/reels';
import { getSubtitlePreview, listSubtitleFonts, listSubtitleTemplates } from '../api/subtitles';
import type { Reel, SubtitleGranularity, SubtitlePosition, SubtitleStyle } from '../types/reel';
import type { SubtitleCuePreview, SubtitlePreview, SubtitleTemplateInfo } from '../types/subtitle';
import { buildOutputClock } from '../utils/reelOutputClock';
import {
  SubtitlePreviewOverlay,
  type SubtitleLayoutPatch,
  FONT_MAX,
  MARGIN_MAX,
} from './SubtitlePreviewOverlay';

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
  /** Allow drag / Alt+wheel on the program monitor overlay. */
  interactivePreview?: boolean;
  /** Project subtitle cues onto the program monitor (subtitles tab only). */
  mountPreviewOverlay?: boolean;
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

const SUBTITLE_EMOJIS = ['🙏', '❤️', '🔥', '✨', '🙌', '📖', '✝️', '👏', '💭', '🕊️'];

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
  interactivePreview = false,
  mountPreviewOverlay = true,
}: SubtitlePanelProps) {
  const [templates, setTemplates] = useState<SubtitleTemplateInfo[]>([]);
  const [fonts, setFonts] = useState<string[]>([]);
  const [preview, setPreview] = useState<SubtitlePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cueDraft, setCueDraft] = useState('');
  const [passDraft, setPassDraft] = useState('');
  const layoutTimerRef = useRef<number | null>(null);
  const pendingLayoutRef = useRef<SubtitleLayoutPatch>({});

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
    listSubtitleFonts()
      .then((data) => setFonts(data.items.map((item) => item.family)))
      .catch(() => setFonts(['Helvetica Neue', 'Georgia', 'Arial']));
  }, []);

  useEffect(() => {
    void loadPreview();
  }, [
    loadPreview,
    reel.subtitle_style,
    reel.subtitle_enabled,
    reel.subtitle_granularity,
    reel.subtitle_font_size,
    reel.subtitle_font_family,
    reel.subtitle_x,
    reel.subtitle_y,
    reel.subtitle_max_words,
    reel.subtitle_uppercase,
    reel.subtitle_bible_reference,
    reel.updated_at,
    // Reload when any per-cut caption changes (fragment subtitle edits).
    reel.segments.map((segment) => `${segment.id}:${segment.transcript_text ?? ''}`).join('|'),
  ]);

  const saveReelPatch = useCallback(
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

  const flushLayoutPatch = useCallback(
    (layoutPatch: SubtitleLayoutPatch) => {
      pendingLayoutRef.current = { ...pendingLayoutRef.current, ...layoutPatch };
      onReelUpdated({ ...reel, ...layoutPatch });
      if (layoutTimerRef.current != null) {
        window.clearTimeout(layoutTimerRef.current);
      }
      layoutTimerRef.current = window.setTimeout(() => {
        layoutTimerRef.current = null;
        const payload = pendingLayoutRef.current;
        pendingLayoutRef.current = {};
        if (Object.keys(payload).length > 0) {
          void saveReelPatch(payload);
        }
      }, 280);
    },
    [onReelUpdated, saveReelPatch, reel],
  );

  useEffect(
    () => () => {
      if (layoutTimerRef.current != null) {
        window.clearTimeout(layoutTimerRef.current);
      }
    },
    [],
  );

  const outputTime = useMemo(() => {
    if (sourceTime == null || previewSegmentIndex == null) return null;
    return sourceToOutput(reel, previewSegmentIndex, sourceTime);
  }, [reel, sourceTime, previewSegmentIndex]);

  const cue = activeCue(preview, outputTime);
  const editingCue = cue != null && cueDraft !== (cue.text ?? '');
  const liveCueText = editingCue
    ? cueDraft
    : cue && outputTime != null
      ? highlightedText(cue, outputTime)
      : null;
  const sample = preview?.cues[0]?.text ?? 'Así dice el Señor: buscadme y viviréis.';
  const stageText = liveCueText ?? sample;
  const outputClock = useMemo(() => buildOutputClock(reel.segments), [reel.segments]);
  const cueIndex = cue && preview ? preview.cues.findIndex((item) => item === cue) : -1;
  const nextCue = cueIndex >= 0 && preview ? preview.cues[cueIndex + 1] ?? null : null;

  function placementAtOutput(time: number) {
    return (
      outputClock.placements.find(
        (item) => time >= item.outputStart && time < item.outputStart + item.contentDuration,
      ) ?? null
    );
  }

  const cueSegmentId = cue ? placementAtOutput(cue.start)?.id ?? null : null;
  const cueSegment = reel.segments.find((item) => item.id === cueSegmentId) ?? null;

  useEffect(() => {
    const text = cue?.text ?? '';
    setCueDraft(text);
    const words = text.trim().split(/\s+/).filter(Boolean);
    setPassDraft(words.slice(-2).join(' '));
  }, [cue?.start, cue?.text]);

  async function saveCueText(nextText: string) {
    if (!cueSegment) {
      setError('Coloca el playhead sobre un subtítulo para editarlo.');
      return;
    }
    const trimmed = nextText.trim();
    if (!trimmed) {
      setError('El subtítulo no puede quedar vacío.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onReelUpdated(
        await updateReelSegment(projectId, reel.id, cueSegment.id, { transcript_text: trimmed }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el subtítulo');
    } finally {
      setBusy(false);
    }
  }

  async function passPhraseToNext() {
    if (!cue || !cueSegment) {
      setError('Coloca el playhead sobre un subtítulo.');
      return;
    }
    const phrase = passDraft.trim();
    if (!phrase) {
      setError('Escribe la palabra o frase que debe pasar al siguiente recuadro.');
      return;
    }
    const cueText = (cueDraft || cue.text).trim();
    const lower = cueText.toLowerCase();
    const phraseLower = phrase.toLowerCase();
    const at = lower.lastIndexOf(phraseLower);
    if (at < 0) {
      setError('Esa frase no está en el subtítulo actual.');
      return;
    }
    const kept = cueText.slice(0, at).trim();
    if (!kept) {
      setError('Deja al menos una palabra en este recuadro.');
      return;
    }
    const movedWord = cue.words.find((word) =>
      phraseLower.startsWith(word.text.replace(/[.,;:!?]+$/g, '').toLowerCase()),
    );
    const splitAt = movedWord
      ? placementAtOutput(movedWord.start)
      : placementAtOutput(cue.start);
    const sourceSeconds = splitAt
      ? splitAt.sourceStart + Math.max(0, (movedWord?.start ?? cue.end - 0.15) - splitAt.outputStart)
      : cueSegment.source_end_seconds - 0.15;
    setBusy(true);
    setError(null);
    try {
      if (nextCue && placementAtOutput(nextCue.start)?.id !== cueSegment.id) {
        const nextId = placementAtOutput(nextCue.start)?.id;
        const nextSegment = reel.segments.find((item) => item.id === nextId);
        onReelUpdated(
          await updateReelSegment(projectId, reel.id, cueSegment.id, { transcript_text: kept }),
        );
        if (nextSegment) {
          const joined = `${phrase} ${nextSegment.transcript_text ?? nextCue.text}`.replace(/\s+/g, ' ').trim();
          onReelUpdated(
            await updateReelSegment(projectId, reel.id, nextSegment.id, { transcript_text: joined }),
          );
        }
      } else {
        const splitSource = Math.min(
          cueSegment.source_end_seconds - 0.2,
          Math.max(cueSegment.source_start_seconds + 0.2, sourceSeconds),
        );
        const updated = await splitReelSegment(projectId, reel.id, cueSegment.id, splitSource);
        const left = updated.segments.find((item) => item.id === cueSegment.id);
        const right = updated.segments.find((item) => item.order === (left?.order ?? 0) + 1);
        let nextReel = updated;
        if (left) {
          nextReel = await updateReelSegment(projectId, updated.id, left.id, {
            transcript_text: kept,
          });
        }
        if (right) {
          nextReel = await updateReelSegment(projectId, updated.id, right.id, {
            transcript_text: `${phrase} ${right.transcript_text ?? ''}`.replace(/\s+/g, ' ').trim(),
          });
        }
        onReelUpdated(nextReel);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo pasar la frase al siguiente recuadro');
    } finally {
      setBusy(false);
    }
  }

  const styleClass = `subtitle-overlay subtitle-overlay--${reel.subtitle_style} subtitle-overlay--${reel.subtitle_position}`;
  const overlayHost =
    typeof document !== 'undefined' ? document.getElementById('reel-subtitle-overlay') : null;

  const overlayNode =
    mountPreviewOverlay && reel.subtitle_enabled && liveCueText && overlayHost ? (
      <SubtitlePreviewOverlay
        text={liveCueText}
        style={reel.subtitle_style}
        position={reel.subtitle_position}
        fontSize={reel.subtitle_font_size}
        opacity={reel.subtitle_opacity}
        marginBottom={reel.subtitle_margin_bottom}
        uppercase={reel.subtitle_uppercase}
        fontFamily={reel.subtitle_font_family}
        posX={reel.subtitle_x}
        posY={reel.subtitle_y}
        interactive={interactivePreview}
        onLayoutChange={flushLayoutPatch}
      />
    ) : null;

  return (
    <div className="subtitle-panel subtitle-panel--inspector">
      {overlayHost && overlayNode ? createPortal(overlayNode, overlayHost) : null}
      <div className="reel-editor__section-header">
        <h4>Subtítulos incrustados (ASS)</h4>
        <label className="field field--inline field--checkbox">
          <input
            type="checkbox"
            checked={reel.subtitle_enabled}
            disabled={busy}
            onChange={(e) => void saveReelPatch({ subtitle_enabled: e.target.checked })}
          />
          <span>Incluir en el render</span>
        </label>
      </div>

      <p className="muted subtitle-panel__hint">
        {interactivePreview
          ? 'Arrastra el subtítulo en la vista previa para moverlo. Alt + rueda del ratón cambia el tamaño. Ortografía y mayúsculas se corrigen aquí, no en Cortes.'
          : 'Abre esta pestaña para ajustar posición, tamaño y el texto del recuadro actual.'}
      </p>

      <div className="subtitle-panel__cue-editor">
        <label className="field">
          <span>Texto de este recuadro</span>
          <textarea
            rows={3}
            value={cueDraft}
            disabled={busy || !reel.subtitle_enabled || !cue}
            placeholder={cue ? 'Corrige ortografía, mayúsculas o añade un emoji…' : 'Reproduce hasta un subtítulo para editarlo'}
            onChange={(event) => setCueDraft(event.target.value)}
            onBlur={() => {
              if (cue && cueDraft.trim() && cueDraft.trim() !== cue.text.trim()) {
                void saveCueText(cueDraft);
              }
            }}
          />
        </label>
        <div className="subtitle-panel__emojis" role="group" aria-label="Emojis">
          {SUBTITLE_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="button button--inline"
              disabled={busy || !cue}
              onClick={() => {
                const next = `${cueDraft}${emoji}`;
                setCueDraft(next);
                void saveCueText(next);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
        <p className="muted">
          Stickers: súbelos en Archivos (imagen) y arrástralos a la línea temporal.
        </p>
        <div className="transcript-toolbar">
          <label className="field">
            <span>Pasar al siguiente recuadro</span>
            <input
              type="text"
              value={passDraft}
              disabled={busy || !cue}
              placeholder="palabra o frase"
              onChange={(event) => setPassDraft(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button button--secondary"
            disabled={busy || !cue || !passDraft.trim()}
            onClick={() => void passPhraseToNext()}
          >
            Pasar frase
          </button>
        </div>
      </div>

      <div className="transcript-toolbar">
        <label className="field field--inline">
          <span>Estilo</span>
          <select
            value={reel.subtitle_style}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => {
              const style = e.target.value as SubtitleStyle;
              const template = templates.find((item) => item.id === style);
              void saveReelPatch({
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
              void saveReelPatch({ subtitle_granularity: e.target.value as SubtitleGranularity })
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
            onChange={(e) => {
              const next = e.target.value as SubtitlePosition;
              void saveReelPatch({
                subtitle_position: next,
                subtitle_x: 0.5,
                subtitle_y: next === 'top' ? 0.12 : next === 'center' ? 0.5 : 0.88,
              });
            }}
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
          <span>Tipografía</span>
          <select
            value={reel.subtitle_font_family ?? ''}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) =>
              void saveReelPatch({ subtitle_font_family: e.target.value || null })
            }
          >
            <option value="">Plantilla</option>
            {fonts.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline">
          <span>Tamaño</span>
          <input
            type="range"
            min={24}
            max={FONT_MAX}
            value={reel.subtitle_font_size}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void saveReelPatch({ subtitle_font_size: Number(e.target.value) })}
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
            onChange={(e) => void saveReelPatch({ subtitle_max_words: Number(e.target.value) })}
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
            onChange={(e) => void saveReelPatch({ subtitle_opacity: Number(e.target.value) })}
          />
        </label>
        <label className="field field--inline">
          <span>Margen inferior</span>
          <input
            type="range"
            min={40}
            max={MARGIN_MAX}
            value={reel.subtitle_margin_bottom}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void saveReelPatch({ subtitle_margin_bottom: Number(e.target.value) })}
          />
          <span className="muted">{reel.subtitle_margin_bottom}px</span>
        </label>
        <label className="field field--inline field--checkbox">
          <input
            type="checkbox"
            checked={reel.subtitle_uppercase}
            disabled={busy || !reel.subtitle_enabled}
            onChange={(e) => void saveReelPatch({ subtitle_uppercase: e.target.checked })}
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
              void saveReelPatch({
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
