import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { ApiError } from '../api/client';
import { applySermonRange, projectVideoUrl, updateProject } from '../api/projects';
import type { Project } from '../types/project';
import { formatDuration, formatTimecode } from '../utils/format';
import { nativeVideoControlProps } from '../utils/nativeMediaControls';

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

export function SermonRangePanel({ project, onUpdated }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const duration = project.duration_seconds ?? 0;
  const [start, setStart] = useState(project.sermon_start_seconds ?? 0);
  const [end, setEnd] = useState(project.sermon_end_seconds ?? duration);
  const rangeRef = useRef({ start, end });
  rangeRef.current = { start, end };
  const [playhead, setPlayhead] = useState(0);
  const [scope, setScope] = useState<'sermon' | 'full'>(
    project.source_kind === 'full_service' ? 'full' : 'sermon',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setStart(project.sermon_start_seconds ?? 0);
    setEnd(project.sermon_end_seconds ?? duration);
  }, [duration, project.sermon_end_seconds, project.sermon_start_seconds]);

  if (!project.has_video) {
    return (
      <section className="card">
        <p className="muted">Importe un video para marcar el intervalo de la predicación.</p>
      </section>
    );
  }

  const windowDuration = Math.max(0, end - start);
  const alreadySermon = project.source_kind === 'sermon_only' && project.sermon_range_confirmed;

  function clampRange(nextStart: number, nextEnd: number) {
    const max = duration || nextEnd;
    const safeStart = Math.min(Math.max(0, nextStart), Math.max(0, max - 1));
    const safeEnd = Math.min(Math.max(safeStart + 1, nextEnd), max || nextEnd);
    setStart(Number(safeStart.toFixed(2)));
    setEnd(Number(safeEnd.toFixed(2)));
  }

  function markStart() {
    const time = videoRef.current?.currentTime ?? playhead;
    clampRange(time, Math.max(time + 1, end));
  }

  function markEnd() {
    const time = videoRef.current?.currentTime ?? playhead;
    clampRange(Math.min(start, time - 1), time);
  }

  function seek(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
  }

  function timeFromClientX(clientX: number, track: HTMLElement) {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0 || !duration) return 0;
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  }

  function beginRangeDrag(event: ReactPointerEvent<HTMLButtonElement>, edge: 'start' | 'end') {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const track = event.currentTarget.parentElement;
    if (!(track instanceof HTMLElement)) return;
    const surface: HTMLElement = track;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    function onMove(move: PointerEvent) {
      if (move.pointerId !== pointerId) return;
      const time = timeFromClientX(move.clientX, surface);
      const current = rangeRef.current;
      if (edge === 'start') clampRange(time, current.end);
      else clampRange(current.start, time);
    }

    function onUp(up: PointerEvent) {
      if (up.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const nextKind = scope === 'full' ? 'full_service' : 'sermon_only';
      if (project.source_kind !== nextKind) {
        await updateProject(project.id, { source_kind: nextKind });
      }
      const rangeStart = scope === 'full' ? 0 : start;
      const rangeEnd = scope === 'full' ? duration || end : end;
      const updated = await applySermonRange(project.id, rangeStart, rangeEnd);
      onUpdated(updated);
      setMessage(
        scope === 'full'
          ? 'Culto completo confirmado. El análisis usará todo el video.'
          : updated.duration_seconds != null &&
              Math.abs((updated.duration_seconds ?? 0) - windowDuration) > 1
            ? 'Predicación recortada. Transcripción y edición usarán solo este tramo.'
            : 'Predicación confirmada. Ya puede transcribir y analizar.',
      );
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'No se pudo confirmar el intervalo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card sermon-range">
      <p className="eyebrow">Predicación</p>
      <h2>Definir dónde está la predicación</h2>
      <fieldset className="field" style={{ border: 'none', padding: 0 }}>
        <span>Qué editar</span>
        <div className="source-toggle" role="radiogroup" aria-label="Alcance del video">
          <label className="source-toggle__option">
            <input
              type="radio"
              name="sermon-scope"
              checked={scope === 'sermon'}
              disabled={busy}
              onChange={() => setScope('sermon')}
            />
            <span>
              Solo predicación
              <small>Marca inicio y final; el resto del culto se descarta.</small>
            </span>
          </label>
          <label className="source-toggle__option">
            <input
              type="radio"
              name="sermon-scope"
              checked={scope === 'full'}
              disabled={busy}
              onChange={() => setScope('full')}
            />
            <span>
              Culto completo
              <small>El análisis y la edición usan todo el archivo.</small>
            </span>
          </label>
        </div>
      </fieldset>
      <p className="muted">
        {scope === 'full'
          ? 'No hace falta marcar inicio ni final: el análisis y la edición usarán todo el archivo.'
          : alreadySermon
            ? 'Este archivo ya es el sermón. Ajusta inicio y final si aún hay algo que recortar.'
            : 'Marca inicio y final de la predicación. Al confirmar, ese tramo queda para transcribir y analizar.'}
      </p>

      {scope === 'sermon' && (
        <>
          <video
            ref={videoRef}
            className="sermon-range__player"
            {...nativeVideoControlProps}
            src={projectVideoUrl(project.id, project.updated_at)}
            onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              if (!project.sermon_end_seconds && event.currentTarget.duration) {
                setEnd(event.currentTarget.duration);
              }
            }}
          />

          <div
            className="sermon-range__timeline"
            role="slider"
            aria-label="Intervalo de la predicación"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest('.sermon-range__handle')) return;
              seek(timeFromClientX(event.clientX, event.currentTarget));
            }}
          >
            <div
              className="sermon-range__window"
              style={{
                left: `${duration ? (start / duration) * 100 : 0}%`,
                width: `${duration ? (windowDuration / duration) * 100 : 0}%`,
              }}
            />
            <button
              type="button"
              className="sermon-range__handle sermon-range__handle--start"
              style={{ left: `${duration ? (start / duration) * 100 : 0}%` }}
              aria-label="Arrastrar inicio de la predicación"
              disabled={busy}
              onPointerDown={(event) => beginRangeDrag(event, 'start')}
            />
            <button
              type="button"
              className="sermon-range__handle sermon-range__handle--end"
              style={{ left: `${duration ? (end / duration) * 100 : 0}%` }}
              aria-label="Arrastrar final de la predicación"
              disabled={busy}
              onPointerDown={(event) => beginRangeDrag(event, 'end')}
            />
            <div
              className="sermon-range__playhead"
              style={{ left: `${duration ? (playhead / duration) * 100 : 0}%` }}
            />
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Inicio</span>
              <input
                type="number"
                min={0}
                max={duration || undefined}
                step="0.1"
                value={start}
                disabled={busy}
                onChange={(event) => clampRange(Number(event.target.value), end)}
              />
              <small className="muted">{formatTimecode(start)}</small>
            </label>
            <label className="field">
              <span>Final</span>
              <input
                type="number"
                min={0}
                max={duration || undefined}
                step="0.1"
                value={end}
                disabled={busy}
                onChange={(event) => clampRange(start, Number(event.target.value))}
              />
              <small className="muted">{formatTimecode(end)}</small>
            </label>
          </div>

          <p className="muted">
            Duración de la predicación: <strong>{formatDuration(windowDuration)}</strong>
            {duration ? ` de ${formatDuration(duration)}` : ''}
          </p>
        </>
      )}

      <div className="sermon-range__actions">
        {scope === 'sermon' && (
          <>
            <button
              type="button"
              className="button button--secondary"
              onClick={markStart}
              disabled={busy}
            >
              Marcar inicio aquí
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={markEnd}
              disabled={busy}
            >
              Marcar final aquí
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => seek(start)}
              disabled={busy}
            >
              Ir al inicio
            </button>
          </>
        )}
        <button
          type="button"
          className="button"
          onClick={() => void handleConfirm()}
          disabled={busy || (scope === 'sermon' && end <= start)}
        >
          {busy ? 'Confirmando…' : scope === 'full' ? 'Confirmar culto completo' : 'Confirmar predicación'}
        </button>
      </div>

      {project.sermon_range_confirmed && (
        <p className="success">
          Intervalo confirmado
          {project.sermon_start_seconds != null && project.sermon_end_seconds != null
            ? ` (${formatTimecode(project.sermon_start_seconds)} – ${formatTimecode(project.sermon_end_seconds)})`
            : ''}
          .
        </p>
      )}
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
