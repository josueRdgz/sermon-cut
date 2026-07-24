import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { deleteProject, getProject } from '../api/projects';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ReelEditor } from '../components/ReelEditor';
import { StatusRow } from '../components/StatusRow';
import { TranscriptEditor } from '../components/TranscriptEditor';
import type { Project } from '../types/project';
import { formatDate, formatDuration, statusLabel } from '../utils/format';

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    getProject(projectId)
      .then((data) => {
        if (!cancelled) setProject(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar el proyecto');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleDelete() {
    if (!project) return;
    setDeleting(true);
    try {
      await deleteProject(project.id);
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Cargando…</p>
      </main>
    );
  }

  if (error || !project) {
    return (
      <main className="page">
        <p className="error">{error ?? 'Proyecto no encontrado'}</p>
        <Link to="/projects">Volver a proyectos</Link>
      </main>
    );
  }

  return (
    <main className="page page--wide">
      <header className="page__header">
        <p className="eyebrow">
          <Link to="/projects">← Proyectos</Link>
        </p>
        <h1>{project.title}</h1>
        <p>
          {project.church_name}
          {project.preacher_name ? ` · ${project.preacher_name}` : ''}
        </p>
      </header>

      <section className="card">
        <h2>Detalles</h2>
        <StatusRow
          label="Estado"
          value={statusLabel(project.status)}
          ok={project.status !== 'failed'}
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
        {project.full_sermon_url && (
          <StatusRow label="Sermón completo" value={project.full_sermon_url} />
        )}
        {project.error_message && (
          <StatusRow label="Error" value={project.error_message} ok={false} />
        )}
      </section>

      <TranscriptEditor projectId={project.id} hasVideo={project.has_video} />

      <ReelEditor
        projectId={project.id}
        hasVideo={project.has_video}
        hasCover={project.has_cover}
        videoDuration={project.duration_seconds}
      />

      <button type="button" className="button button--danger" onClick={() => setConfirmOpen(true)}>
        Eliminar proyecto
      </button>

      {confirmOpen && (
        <ConfirmDialog
          title="Eliminar proyecto"
          message={`¿Seguro que quieres eliminar «${project.title}»? Esta acción no se puede deshacer.`}
          busy={deleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => !deleting && setConfirmOpen(false)}
        />
      )}
    </main>
  );
}
