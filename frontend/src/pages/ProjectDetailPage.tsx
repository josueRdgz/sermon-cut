import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { deleteProject, deleteProjectVideo, getProject } from '../api/projects';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { AudioRepairPanel } from '../components/AudioRepairPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ReelEditor } from '../components/ReelEditor';
import { SermonRangePanel } from '../components/SermonRangePanel';
import { StatusRow } from '../components/StatusRow';
import { TranscriptEditor } from '../components/TranscriptEditor';
import { VideoHighlightsPanel } from '../components/VideoHighlightsPanel';
import type { Project } from '../types/project';
import { formatDate, formatDuration, statusLabel } from '../utils/format';
import { pinWorkspaceNav } from '../utils/workspaceScroll';

const WORKSPACE_SECTIONS = [
  {
    id: 'project',
    label: 'Proyecto',
    description: 'Archivo y datos',
  },
  {
    id: 'audio',
    label: 'Reparar audio',
    description: 'Detectar microcortes',
  },
  {
    id: 'sermon',
    label: 'Predicación',
    description: 'Inicio y final',
  },
  {
    id: 'transcript',
    label: 'Transcripción',
    description: 'Texto y tiempos',
  },
  {
    id: 'analysis',
    label: 'Análisis IA',
    description: 'Propuestas de Reels',
  },
  {
    id: 'editor',
    label: 'Editor de Reel',
    description: 'Editar y exportar',
  },
  {
    id: 'highlights',
    label: 'Video Highlights',
    description: 'Resumen horizontal',
  },
] as const;

type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]['id'];

function isWorkspaceSection(value: string | null): value is WorkspaceSection {
  return WORKSPACE_SECTIONS.some((section) => section.id === value);
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceRef = useRef<HTMLElement>(null);
  const workspaceNavRef = useRef<HTMLElement>(null);
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
      window.requestAnimationFrame(pinWorkspaceNav);
    },
    [searchParams, setSearchParams],
  );

  const handleTranscriptChanged = useCallback(() => {
    setTranscriptRevision((revision) => revision + 1);
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
    const workspace = workspaceRef.current;
    const nav = workspaceNavRef.current;
    if (!workspace || !nav) return;
    const applyOffset = () => {
      const styles = window.getComputedStyle(nav);
      const margin = Number.parseFloat(styles.marginBottom) || 0;
      workspace.style.setProperty('--workspace-nav-offset', `${nav.offsetHeight + margin}px`);
    };
    applyOffset();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(applyOffset);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [visibleSections.length, activeSection]);

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
    <main ref={workspaceRef} className="page page--wide project-workspace">
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

      <nav ref={workspaceNavRef} className="workspace-nav" aria-label="Flujo del proyecto">
        <div className="workspace-nav__track" role="tablist" aria-label="Categorías">
          {visibleSections.map((section, index) => (
            <button
              key={section.id}
              id={`workspace-tab-${section.id}`}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              aria-controls={`workspace-panel-${section.id}`}
              className={`workspace-nav__tab${
                activeSection === section.id ? ' workspace-nav__tab--active' : ''
              }`}
              onClick={() => activateSection(section.id)}
            >
              <span className="workspace-nav__number">{index + 1}</span>
              <span>
                <strong>{section.label}</strong>
              </span>
            </button>
          ))}
        </div>
      </nav>

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
        <SermonRangePanel project={project} onUpdated={setProject} />
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
      >
        <ReelEditor
          projectId={project.id}
          hasVideo={project.has_video}
          hasCover={project.has_cover}
          videoDuration={project.duration_seconds}
          refreshToken={reelRevision}
          focusReelId={reelToFocus}
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
    </main>
  );
}
