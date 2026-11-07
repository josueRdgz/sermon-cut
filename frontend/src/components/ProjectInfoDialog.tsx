import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { deleteProjectVideo } from '../api/projects';
import type { Project } from '../types/project';
import { formatDate, formatDuration, statusLabel } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusRow } from './StatusRow';

interface ProjectInfoDialogProps {
  project: Project;
  onClose: () => void;
  onUpdated?: (project: Project) => void;
}

export function ProjectInfoDialog({ project, onClose, onUpdated }: ProjectInfoDialogProps) {
  const [confirmVideoDelete, setConfirmVideoDelete] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deletingVideo && !confirmVideoDelete) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmVideoDelete, deletingVideo, onClose]);

  async function handleDeleteVideo() {
    setDeletingVideo(true);
    setError(null);
    try {
      const updated = await deleteProjectVideo(project.id);
      onUpdated?.(updated);
      setConfirmVideoDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el video');
    } finally {
      setDeletingVideo(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="dialog-backdrop dialog-backdrop--modal" role="presentation" onClick={onClose}>
        <div
          className="dialog dialog--info"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-info-title"
          onClick={(event) => event.stopPropagation()}
        >
          <h2 id="project-info-title">{project.title}</h2>
          <StatusRow
            label="Estado"
            value={statusLabel(project.status)}
            ok={project.status !== 'failed'}
          />
          <StatusRow
            label="Grabación"
            value={project.source_kind === 'full_service' ? 'Culto completo' : 'Solo el sermón'}
          />
          <StatusRow
            label="Predicación"
            value={
              project.sermon_range_confirmed
                ? 'Intervalo confirmado'
                : project.source_kind === 'full_service'
                  ? 'Pendiente de marcar'
                  : 'Todo el archivo'
            }
          />
          <StatusRow label="Duración" value={formatDuration(project.duration_seconds)} />
          <StatusRow label="Resolución" value={project.resolution ?? '—'} />
          <StatusRow label="FPS" value={project.fps != null ? String(project.fps) : '—'} />
          <StatusRow label="Códec video" value={project.video_codec ?? '—'} />
          <StatusRow label="Códec audio" value={project.audio_codec ?? '—'} />
          <StatusRow
            label="Video"
            value={project.has_video ? (project.video_filename ?? 'Sí') : 'No'}
          />
          <StatusRow
            label="Portada"
            value={project.has_cover ? (project.cover_filename ?? 'Sí') : 'No'}
          />
          <StatusRow label="Referencia" value={project.bible_reference ?? '—'} />
          <StatusRow label="Canal YouTube" value={project.youtube_channel} />
          <StatusRow label="Creado" value={formatDate(project.created_at)} />
          <StatusRow label="Modificado" value={formatDate(project.updated_at)} />
          {project.full_sermon_url ? (
            <StatusRow label="Sermón completo" value={project.full_sermon_url} />
          ) : null}
          {project.error_message ? (
            <StatusRow label="Error" value={project.error_message} ok={false} />
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="dialog__actions">
            {project.has_video ? (
              <button
                type="button"
                className="button button--danger button--inline"
                onClick={() => setConfirmVideoDelete(true)}
              >
                Eliminar video original
              </button>
            ) : null}
            <button type="button" className="button button--secondary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
      {confirmVideoDelete ? (
        <ConfirmDialog
          title="Eliminar video original"
          message="Se borrará el archivo original para liberar espacio. La transcripción, los cortes, la portada y los Reels ya exportados se conservarán."
          confirmLabel="Eliminar video"
          busy={deletingVideo}
          onConfirm={() => void handleDeleteVideo()}
          onCancel={() => !deletingVideo && setConfirmVideoDelete(false)}
        />
      ) : null}
    </>,
    document.body,
  );
}
