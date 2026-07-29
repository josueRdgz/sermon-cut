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
  onTranscriptChanged?: () => void;
}

const TRANSCRIPT_ACCEPT = '.srt,.vtt,.json,.txt,text/plain,application/json';

export function TranscriptEditor({
  projectId,
  hasVideo,
  onTranscriptChanged,
}: TranscriptEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  }

  async function handleSaveSegment(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const payload: {
        text: string;
        start_seconds?: number | null;
        end_seconds?: number | null;
      } = { text: editText };
      if (editStart !== '') payload.start_seconds = Number(editStart);
      if (editEnd !== '') payload.end_seconds = Number(editEnd);
      const updated = await updateSegment(editing.id, payload);
      setTranscript(updated);
      onTranscriptChanged?.();
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el segmento');
    } finally {
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
    setSaving(true);
    try {
      await deleteTranscript(projectId);
      setTranscript(null);
      onTranscriptChanged?.();
      setConfirmDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
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
      {error && <p className="error">{error}</p>}

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
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={() => !saving && setEditing(null)}
        >
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
              />
            </label>
            <details className="transcript-correction-dialog__timing">
              <summary>Ajustar tiempos (avanzado)</summary>
              <div className="field-row">
                <label className="field">
                  <span>Inicio (s)</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Fin (s)</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                  />
                </label>
              </div>
            </details>
            <div className="dialog__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setEditing(null)}
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
