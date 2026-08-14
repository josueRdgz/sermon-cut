import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import { applySermonRange, projectVideoUrl } from '../api/projects';
import type { Project } from '../types/project';
import { formatDuration, formatTimecode } from '../utils/format';

interface Props {
  project: Project;
  onUpdated: (project: Project) => void;
}

export function SermonRangePanel({ project, onUpdated }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const duration = project.duration_seconds ?? 0;
  const [start, setStart] = useState(project.sermon_start_seconds ?? 0);
  const [end, setEnd] = useState(project.sermon_end_seconds ?? duration);
  const [playhead, setPlayhead] = useState(0);
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

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await applySermonRange(project.id, start, end);
      onUpdated(updated);
      setMessage(
        updated.duration_seconds != null &&
          Math.abs((updated.duration_seconds ?? 0) - windowDuration) > 1
          ? 'Predicación recortada. Transcripción y edición usarán solo este tramo.'
          : 'Intervalo confirmado. Ya puede transcribir y editar.',
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
      <p className="muted">
        {alreadySermon
          ? 'Este archivo ya es el sermón. Puede ajustar inicio y final si aún hay algo que recortar.'
          : 'Marque inicio y final de la predicación en la línea de tiempo. Al confirmar, el resto del culto se descarta y ese pedazo queda para transcribir y editar.'}
      </p>

      <video
        ref={videoRef}
        className="sermon-range__player"
        controls
        src={`${projectVideoUrl(project.id)}?t=${encodeURIComponent(project.updated_at)}`}
        onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          if (!project.sermon_end_seconds && event.currentTarget.duration) {
            setEnd(event.currentTarget.duration);
          }
        }}
      />

      <div className="sermon-range__timeline" aria-hidden="true">
        <div
          className="sermon-range__window"
          style={{
            left: `${duration ? (start / duration) * 100 : 0}%`,
            width: `${duration ? (windowDuration / duration) * 100 : 0}%`,
          }}
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

      <div className="sermon-range__actions">
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
        <button
          type="button"
          className="button"
          onClick={() => void handleConfirm()}
          disabled={busy || end <= start}
        >
          {busy ? 'Recortando…' : 'Confirmar predicación'}
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
