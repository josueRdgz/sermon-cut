import { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, FileText, Mic, Sparkles } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { getProject } from '../api/projects';
import { AnalysisPanel } from '../components/AnalysisPanel';
import { AppChrome } from '../components/layout/AppChrome';
import { ReelEditor } from '../components/ReelEditor';
import { SermonRangePanel } from '../components/SermonRangePanel';
import { TranscriptEditor } from '../components/TranscriptEditor';
import { useProjects } from '../hooks/useProjects';
import type { Project } from '../types/project';

const WORKSPACE_SECTIONS = [
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
] as const;

type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]['id'];

function isWorkspaceSection(value: string | null): value is WorkspaceSection {
  return WORKSPACE_SECTIONS.some((section) => section.id === value);
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const [reelRevision, setReelRevision] = useState(0);
  const requestedSection = searchParams.get('section');
  const requestedWorkspaceSection: WorkspaceSection = isWorkspaceSection(requestedSection)
    ? requestedSection
    : 'sermon';
  const activeSection: WorkspaceSection = requestedWorkspaceSection;
  const visibleSections = WORKSPACE_SECTIONS;

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

  function handleCoverUpdated(updated: Project) {
    setProject(updated);
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
      projectCount={projects.length}
      workspace={{
        items: visibleSections.map((section) => ({
          id: section.id,
          label: section.label,
          icon: section.icon,
        })),
        activeId: activeSection,
        onSelect: (id: string) => {
          if (isWorkspaceSection(id)) activateSection(id);
        },
      }}
      context={
        isEditor ? undefined : (
          <span className="workspace-top-title" title={project.title}>
            {project.title}
          </span>
        )
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
        id="workspace-panel-sermon"
        role="tabpanel"
        aria-labelledby="workspace-tab-sermon"
        hidden={activeSection !== 'sermon'}
      >
        <SermonRangePanel project={project} onUpdated={handleSermonUpdated} />
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
          sourceKind={project.source_kind}
          onOpenEditor={() => {
            setReelRevision((revision) => revision + 1);
            activateSection('editor');
          }}
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
          active={activeSection === 'editor'}
          onCoverUpdated={handleCoverUpdated}
        />
      </div>
    </div>
    </AppChrome>
  );
}
