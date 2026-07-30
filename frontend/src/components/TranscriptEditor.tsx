import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { ApiError } from '../api/client';
import {
  deleteTranscript,
  getTranscript,
  projectVideoUrl,
  transcriptExportUrl,
  updateSegment,
  uploadTranscript,
} from '../api/transcripts';
import type { Transcript, TranscriptSegment } from '../types/transcript';
import { formatDuration } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { TranscriptionPanel } from './TranscriptionPanel';

interface TranscriptEditorProps {
  projectId: string;
  hasVideo: boolean;
  videoDuration?: number | null;
  onTranscriptChanged?: () => void;
}

const TRANSCRIPT_ACCEPT = '.srt,.vtt,.json,.txt,text/plain,application/json';

function parseTimingField(raw: string, label: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, error: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { value: null, error: `${label} debe ser un número finito.` };
  }
  if (value < 0) {
    return { value: null, error: `${label} no puede ser negativo.` };
  }
  return { value, error: null };
}

export function TranscriptEditor({
  projectId,
  hasVideo,
  videoDuration = null,
  onTranscriptChanged,
}: TranscriptEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const savingRef = useRef(false);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TranscriptSegment | null>(null);
  const [editText, setEditText] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [language, setLanguage] = useState('es');

  const loadTranscript = useCallback(() => {
    setLoading(true);
    return getTranscript(projectId)
      .then((data) => {
        setTranscript(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setTranscript(null);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : 'No se pudo cargar la transcripción');
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    void loadTranscript();
  }, [loadTranscript]);

  const filteredSegments = useMemo(() => {
    if (!transcript) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return transcript.segments;
    return transcript.segments.filter((segment) => segment.text.toLowerCase().includes(needle));
  }, [transcript, query]);

  function seekTo(seconds: number | null) {
    if (seconds == null || !videoRef.current) return;
    videoRef.current.currentTime = seconds;
    void videoRef.current.play();
  }

  function openEditor(segment: TranscriptSegment) {
    setEditing(segment);
    setEditText(segment.text);
    setEditStart(segment.start_seconds != null ? String(segment.start_seconds) : '');
    setEditEnd(segment.end_seconds != null ? String(segment.end_seconds) : '');
    setFieldError(null);
    setError(null);
  }

  function closeEditor() {
    if (savingRef.current) return;
    setEditing(null);
    setFieldError(null);
  }

  async function handleSaveSegment(event: FormEvent) {
    event.preventDefault();
    if (!editing || savingRef.current) return;

    const startParsed = parseTimingField(editStart, 'El inicio');
    const endParsed = parseTimingField(editEnd, 'El fin');
    if (startParsed.error || endParsed.error) {
      setFieldError(startParsed.error ?? endParsed.error);
      return;
    }
    if (
      (editStart !== '' && startParsed.value == null) ||
      (editEnd !== '' && endParsed.value == null)
    ) {
      setFieldError('Inicio y fin deben ser números válidos.');
      return;
    }
    if (startParsed.value != null && endParsed.value != null && startParsed.value >= endParsed.value) {
      setFieldError('El inicio debe ser menor que el fin.');
      return;
    }
    if (
      videoDuration != null &&
      Number.isFinite(videoDuration) &&
      endParsed.value != null &&
      endParsed.value > videoDuration
    ) {
      setFieldError(`El fin no puede superar la duración del video (${videoDuration}s).`);
      return;
    }
    if (!editText.trim()) {
      setFieldError('El texto del segmento no puede estar vacío.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setFieldError(null);
    setError(null);
    try {
      const payload: {
        text: string;
        start_seconds?: number | null;
        end_seconds?: number | null;
      } = { text: editText.trim() };
      if (editStart !== '') payload.start_seconds = startParsed.value;
      if (editEnd !== '') payload.end_seconds = endParsed.value;
      const updated = await updateSegment(editing.id, payload);
      // Refresh transcript data only — keep the same video element mounted.
      setTranscript(updated);
      onTranscriptChanged?.();
      setEditing(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo guardar el segmento';
      setFieldError(message);
      // Keep the editor open on validation / network errors.
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleUpload(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const created = await uploadTranscript(projectId, file, language);
      setTranscript(created);
      onTranscriptChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo importar la transcripción');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await deleteTranscript(projectId);
      setTranscript(null);
      onTranscriptChanged?.();
      setConfirmDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="card transcript-editor">
      <div className="transcript-editor__header">
        <h2>Transcripción</h2>
        {transcript && (
          <span className={`badge badge--${transcript.status}`}>
            {transcript.status === 'unsynced' ? 'Sin sincronizar' : 'Lista'}
          </span>
        )}
      </div>

      {hasVideo && (
        <video
          ref={videoRef}
          className="transcript-editor__video"
          controls
          preload="metadata"
          src={projectVideoUrl(projectId)}
        >
          Tu navegador no soporta video HTML5.
        </video>
      )}

      {!hasVideo && (
        <p className="muted">Sube un video al proyecto para sincronizar la reproducción.</p>
      )}

      <TranscriptionPanel
        projectId={projectId}
        hasVideo={hasVideo}
        onCompleted={() => {
          void loadTranscript().then(() => onTranscriptChanged?.());
        }}
      />

      <div className="transcript-toolbar">
        <label className="field field--inline">
          <span>Idioma</span>
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            maxLength={16}
            disabled={uploading}
          />
        </label>
        <label className="field field--inline">
          <span>Importar (SRT, VTT, JSON, TXT)</span>
          <input
            type="file"
            accept={TRANSCRIPT_ACCEPT}
            disabled={uploading}
            onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {uploading && <p className="muted">Importando transcripción…</p>}
      {loading && <p className="muted">Cargando transcripción…</p>}
      {error && !editing && <p className="error">{error}</p>}

      {!loading && !transcript && !uploading && (
        <p className="muted">Aún no hay transcripción. Importa un archivo para empezar.</p>
      )}

      {transcript && (
        <>
          <div className="transcript-toolbar">
            <label className="field field--grow">
              <span>Buscar en la transcripción</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar segmentos…"
              />
            </label>
            <div className="transcript-exports">
              {transcript.status !== 'unsynced' && (
                <>
                  <a
                    className="button button--secondary button--inline"
                    href={transcriptExportUrl(projectId, 'srt')}
                  >
                    SRT
                  </a>
                  <a
                    className="button button--secondary button--inline"
                    href={transcriptExportUrl(projectId, 'vtt')}
                  >
                    VTT
                  </a>
                </>
              )}
              <a
                className="button button--secondary button--inline"
                href={transcriptExportUrl(projectId, 'json')}
              >
                JSON
              </a>
              <button
                type="button"
                className="button button--danger button--inline"
                onClick={() => setConfirmDelete(true)}
              >
                Eliminar
              </button>
            </div>
          </div>

          <p className="muted">
            Fuente: {transcript.source} · {transcript.segments.length} segmentos
            {transcript.has_word_timestamps ? ' · con tiempos por palabra' : ''}
          </p>
          <p className="muted">
            Si la transcripción contiene un error, usa «Corregir texto» en el segmento
            correspondiente. La corrección se aplicará también a los subtítulos del Reel.
          </p>

          <ul className="segment-list">
            {filteredSegments.map((segment) => (
              <li
                key={segment.id}
                className={`segment-item${activeId === segment.id ? ' segment-item--active' : ''}`}
              >
                <button
                  type="button"
                  className="segment-item__seek"
                  onClick={() => {
                    setActiveId(segment.id);
                    seekTo(segment.start_seconds);
                  }}
                >
                  <span className="segment-item__time">
                    {segment.start_seconds != null
                      ? `${formatDuration(segment.start_seconds)} – ${formatDuration(segment.end_seconds)}`
                      : 'Sin tiempo'}
                  </span>
                  <span className="segment-item__text">{segment.text}</span>
                </button>
                <button
                  type="button"
                  className="button button--secondary button--inline"
                  onClick={() => openEditor(segment)}
                >
                  Corregir texto
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <div className="dialog-backdrop" role="presentation" onClick={closeEditor}>
          <form
            className="dialog transcript-correction-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Corregir transcripción"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(e) => void handleSaveSegment(e)}
          >
            <h2>Corregir transcripción</h2>
            <p>
              Corrige una palabra, nombre o frase. Se conservará la sincronización para los
              subtítulos.
            </p>
            <label className="field">
              <span>Texto</span>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={5}
                required
                autoFocus
                disabled={saving}
              />
            </label>
            <details className="transcript-correction-dialog__timing" open>
              <summary>Ajustar tiempos</summary>
              <div className="field-row">
                <label className="field">
                  <span>Inicio (s)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Inicio (s)"
                    value={editStart}
                    disabled={saving}
                    onChange={(e) => {
                      setEditStart(e.target.value);
                      setFieldError(null);
                    }}
                  />
                </label>
                <label className="field">
                  <span>Fin (s)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Fin (s)"
                    value={editEnd}
                    disabled={saving}
                    onChange={(e) => {
                      setEditEnd(e.target.value);
                      setFieldError(null);
                    }}
                  />
                </label>
              </div>
              <p className="muted">
                Si el nuevo rango invade el segmento vecino, se ajustará el límite compartido
                automáticamente cuando sea seguro.
              </p>
            </details>
            {fieldError && (
              <p className="error" role="alert">
                {fieldError}
              </p>
            )}
            <div className="dialog__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={closeEditor}
                disabled={saving}
              >
                Cancelar
              </button>
              <button type="submit" className="button" disabled={saving || !editText.trim()}>
                {saving ? 'Guardando…' : 'Guardar corrección'}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Eliminar transcripción"
          message="¿Seguro que quieres eliminar la transcripción de este proyecto?"
          busy={saving}
          onConfirm={() => void handleDelete()}
          onCancel={() => !saving && setConfirmDelete(false)}
        />
      )}
    </section>
  );
}
