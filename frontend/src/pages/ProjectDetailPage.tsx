import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clapperboard,
  FileAudio,
  FileText,
  FolderOpen,
  Mic,
  Sparkles,
  StretchHorizontal,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  deleteProject,
  deleteProjectVideo,
  getProject,
  projectCoverUrl,
  uploadProjectCover,
} from '../api/projects';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { AudioRepairPanel } from '../components/AudioRepairPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AppChrome } from '../components/layout/AppChrome';
import { ReelEditor } from '../components/ReelEditor';
import { SermonRangePanel } from '../components/SermonRangePanel';
import { StatusRow } from '../components/StatusRow';
import { TranscriptEditor } from '../components/TranscriptEditor';
import { VideoHighlightsPanel } from '../components/VideoHighlightsPanel';
import { useProjects } from '../hooks/useProjects';
import type { Project } from '../types/project';
import { formatDate, formatDuration, statusLabel } from '../utils/format';

const WORKSPACE_SECTIONS = [
  {
    id: 'project',
    label: 'Proyecto',
    description: 'Archivo y datos',
    icon: FolderOpen,
  },
  {
    id: 'audio',
    label: 'Reparar audio',
    description: 'Detectar microcortes',
    icon: FileAudio,
  },
  {
    id: 'sermon',
    label: 'Predicación',
    description: 'Inicio y final',
    icon: Mic,
  },
  {
    id: 'transcript',
    label: 'Transcripción',
    description: 'Texto y tiempos',
    icon: FileText,
  },
  {
    id: 'analysis',
    label: 'Análisis IA',
    description: 'Propuestas de Reels',
    icon: Sparkles,
  },
  {
    id: 'editor',
    label: 'Editor de Reel',
    description: 'Editar y exportar',
    icon: Clapperboard,
  },
  {
    id: 'highlights',
    label: 'Video Highlights',
    description: 'Resumen horizontal',
    icon: StretchHorizontal,
  },
] as const;

type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]['id'];

function isWorkspaceSection(value: string | null): value is WorkspaceSection {
  return WORKSPACE_SECTIONS.some((section) => section.id === value);
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmVideoDelete, setConfirmVideoDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState(false);
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const [reelRevision, setReelRevision] = useState(0);
  const [reelToFocus, setReelToFocus] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverProgress, setCoverProgress] = useState(0);
  const [coverError, setCoverError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const requestedSection = searchParams.get('section');
  const requestedWorkspaceSection: WorkspaceSection = isWorkspaceSection(requestedSection)
    ? requestedSection
    : 'project';
  const sectionAllowed =
    !project ||
    !(
      (project.content_mode === 'highlights' &&
        (requestedWorkspaceSection === 'analysis' || requestedWorkspaceSection === 'editor')) ||
      (project.content_mode === 'shorts' && requestedWorkspaceSection === 'highlights')
    );
  const activeSection: WorkspaceSection = sectionAllowed ? requestedWorkspaceSection : 'project';
  const visibleSections = WORKSPACE_SECTIONS.filter((section) => {
    if (!project) return section.id === 'project';
    if (section.id === 'analysis' || section.id === 'editor') {
      return project.content_mode !== 'highlights';
    }
    if (section.id === 'highlights') return project.content_mode !== 'shorts';
    return true;
  });

  const activateSection = useCallback(
    (section: WorkspaceSection) => {
      workspaceRef.current
        ?.querySelectorAll<HTMLMediaElement>('video, audio')
        .forEach((media) => media.pause());
      const next = new URLSearchParams(searchParams);
      next.set('section', section);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleTranscriptChanged = useCallback(() => {
    setTranscriptRevision((revision) => revision + 1);
  }, []);

  const handleSermonUpdated = useCallback((updated: Project) => {
    setProject(updated);
    setTranscriptRevision((revision) => revision + 1);
    setReelRevision((revision) => revision + 1);
  }, []);

  const handleCandidateAccepted = useCallback(
    (reelId: string) => {
      setReelToFocus(reelId);
      setReelRevision((revision) => revision + 1);
      activateSection('editor');
    },
    [activateSection],
  );

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

  async function handleDeleteVideo() {
    if (!project) return;
    setDeletingVideo(true);
    setError(null);
    try {
      const updated = await deleteProjectVideo(project.id);
      setProject(updated);
      setConfirmVideoDelete(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el video');
    } finally {
      setDeletingVideo(false);
    }
  }

  function handleCoverUpdated(updated: Project) {
    setProject(updated);
    setCoverError(null);
  }

  async function handleCoverFile(file: File | null) {
    if (!project || !file) return;
    setCoverBusy(true);
    setCoverProgress(0);
    setCoverError(null);
    try {
      const updated = await uploadProjectCover(project.id, file, setCoverProgress);
      setProject(updated);
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : 'No se pudo subir la portada');
    } finally {
      setCoverBusy(false);
      setCoverProgress(0);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  }

  if (loading) {
    return (
      <AppChrome projectCount={projects.length}>
        <p className="muted">Cargando…</p>
      </AppChrome>
    );
  }

  if (error || !project) {
    return (
      <AppChrome projectCount={projects.length}>
        <p className="error">{error ?? 'Proyecto no encontrado'}</p>
        <Link to="/projects">Volver a proyectos</Link>
      </AppChrome>
    );
  }

  const isEditor = activeSection === 'editor';

  return (
    <AppChrome
      flush={isEditor}
      hideFooter={isEditor}
      projectCount={projects.length}
      workspace={{
        items: visibleSections.map((section) => ({
          id: section.id,
          label: section.label,
          icon: section.icon,
        })),
        activeId: activeSection,
        onSelect: (id) => {
          if (isWorkspaceSection(id)) activateSection(id);
        },
      }}
      actions={
        <span className="workspace-top-title" title={project.title}>
          {project.title}
        </span>
      }
    >
    <div
      ref={workspaceRef}
      className={`project-workspace${isEditor ? ' project-workspace--nle' : ''}`}
    >
      {!isEditor && (
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
      )}

      <div
        id="workspace-panel-project"
        role="tabpanel"
        aria-labelledby="workspace-tab-project"
        hidden={activeSection !== 'project'}
      >
        <section className="card">
          <h2>Detalles</h2>
          <StatusRow
            label="Estado"
            value={statusLabel(project.status)}
            ok={project.status !== 'failed'}
          />
          <StatusRow
            label="Tipo de contenido"
            value={
              project.content_mode === 'both'
                ? 'Shorts y Video Highlights'
                : project.content_mode === 'highlights'
                  ? 'Video Highlights'
                  : 'Shorts'
            }
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
          <div className="project-cover-actions">
            {project.has_cover && (
              <img
                className="project-cover-actions__thumb"
                src={projectCoverUrl(project.id, project.updated_at)}
                alt="Portada del proyecto"
              />
            )}
            <input
              ref={coverInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => void handleCoverFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="button button--inline"
              disabled={coverBusy}
              onClick={() => coverInputRef.current?.click()}
            >
              {coverBusy
                ? `Subiendo… ${coverProgress}%`
                : project.has_cover
                  ? 'Cambiar portada'
                  : 'Subir portada'}
            </button>
            {coverError && <p className="error">{coverError}</p>}
          </div>
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
          {project.has_video && (
            <button
              type="button"
              className="button button--danger button--inline"
              onClick={() => setConfirmVideoDelete(true)}
            >
              Eliminar video original
            </button>
          )}
        </section>
        <button
          type="button"
          className="button button--danger"
          onClick={() => setConfirmOpen(true)}
        >
          Eliminar proyecto
        </button>
      </div>

      <div
        id="workspace-panel-audio"
        role="tabpanel"
        aria-labelledby="workspace-tab-audio"
        hidden={activeSection !== 'audio'}
      >
        <AudioRepairPanel projectId={project.id} hasVideo={project.has_video} />
      </div>

      <div
        id="workspace-panel-sermon"
        role="tabpanel"
        aria-labelledby="workspace-tab-sermon"
        hidden={activeSection !== 'sermon'}
      >
        <SermonRangePanel project={project} onUpdated={handleSermonUpdated} />
      </div>

      <div
        id="workspace-panel-highlights"
        role="tabpanel"
        aria-labelledby="workspace-tab-highlights"
        hidden={activeSection !== 'highlights'}
      >
        <VideoHighlightsPanel
          projectId={project.id}
          hasVideo={project.has_video}
          hasCover={project.has_cover}
          videoDuration={project.duration_seconds}
          transcriptRevision={transcriptRevision}
          churchName={project.church_name}
          onCoverUpdated={handleCoverUpdated}
        />
      </div>

      <div
        id="workspace-panel-transcript"
        role="tabpanel"
        aria-labelledby="workspace-tab-transcript"
        hidden={activeSection !== 'transcript'}
      >
        <TranscriptEditor
          projectId={project.id}
          hasVideo={project.has_video}
          videoDuration={project.duration_seconds}
          mediaRevision={project.updated_at}
          onTranscriptChanged={handleTranscriptChanged}
        />
      </div>

      <div
        id="workspace-panel-analysis"
        role="tabpanel"
        aria-labelledby="workspace-tab-analysis"
        hidden={activeSection !== 'analysis'}
      >
        <AnalysisPanel
          projectId={project.id}
          transcriptRevision={transcriptRevision}
          onCandidateAccepted={handleCandidateAccepted}
        />
      </div>

      <div
        id="workspace-panel-editor"
        role="tabpanel"
        aria-labelledby="workspace-tab-editor"
        hidden={activeSection !== 'editor'}
        className={activeSection === 'editor' ? 'workspace-panel-editor' : undefined}
      >
        <ReelEditor
          projectId={project.id}
          hasVideo={project.has_video}
          hasCover={project.has_cover}
          videoDuration={project.duration_seconds}
          mediaRevision={project.updated_at}
          refreshToken={reelRevision}
          focusReelId={reelToFocus}
          onCoverUpdated={handleCoverUpdated}
        />
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title="Eliminar proyecto"
          message={`¿Seguro que quieres eliminar «${project.title}»? Esta acción no se puede deshacer.`}
          busy={deleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => !deleting && setConfirmOpen(false)}
        />
      )}

      {confirmVideoDelete && (
        <ConfirmDialog
          title="Eliminar video original"
          message="Se borrará el archivo original para liberar espacio. La transcripción, los cortes, la portada y los Reels ya exportados se conservarán."
          confirmLabel="Eliminar video"
          busy={deletingVideo}
          onConfirm={() => void handleDeleteVideo()}
          onCancel={() => !deletingVideo && setConfirmVideoDelete(false)}
        />
      )}
    </div>
    </AppChrome>
  );
}
