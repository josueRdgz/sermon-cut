import { Link } from 'react-router-dom';

import type { Project } from '../types/project';
import { formatDate, formatDuration, statusLabel } from '../utils/format';

interface ProjectCardProps {
  project: Project;
  onDelete: (project: Project) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  return (
    <article className="project-card">
      <div className="project-card__body">
        <div className="project-card__top">
          <h3 className="project-card__title">{project.title}</h3>
          <span className={`badge badge--${project.status}`}>{statusLabel(project.status)}</span>
        </div>
        <p className="project-card__meta">
          {project.church_name}
          {project.preacher_name ? ` · ${project.preacher_name}` : ''}
        </p>
        <dl className="project-card__stats">
          <div>
            <dt>Duración</dt>
            <dd>{formatDuration(project.duration_seconds)}</dd>
          </div>
          <div>
            <dt>Resolución</dt>
            <dd>{project.resolution ?? '—'}</dd>
          </div>
          <div>
            <dt>Fecha</dt>
            <dd>{formatDate(project.created_at)}</dd>
          </div>
        </dl>
      </div>
      <div className="project-card__actions">
        <Link className="button button--secondary" to={`/projects/${project.id}`}>
          Abrir
        </Link>
        <button type="button" className="button button--danger" onClick={() => onDelete(project)}>
          Eliminar
        </button>
      </div>
    </article>
  );
}
