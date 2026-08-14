import { ArrowRight, Clock, Film, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { projectCoverUrl } from '../api/projects';
import type { Project } from '../types/project';
import { formatDuration, formatRelativeTime, statusLabel } from '../utils/format';
import styles from './ProjectCard.module.css';

interface ProjectCardProps {
  project: Project;
  onDelete?: (project: Project) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const [coverFailed, setCoverFailed] = useState(false);
  const showCover = project.has_cover && !coverFailed;
  const subtitle = [project.church_name, project.preacher_name].filter(Boolean).join(' · ');

  return (
    <article className={styles.card}>
      <div className={styles.thumb}>
        {showCover ? (
          <img
            className={styles.cover}
            src={projectCoverUrl(project.id, project.updated_at)}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <span className={styles.placeholder} aria-hidden>
            <Film size={26} strokeWidth={1.5} />
          </span>
        )}
        <span className={`${styles.badge} ${styles[`status_${project.status}`] ?? ''}`}>
          {statusLabel(project.status)}
        </span>
        {project.duration_seconds != null ? (
          <span className={styles.duration}>{formatDuration(project.duration_seconds)}</span>
        ) : null}
      </div>

      <div className={styles.body}>
        <h3 className={styles.title} title={project.title}>
          {project.title}
        </h3>
        {subtitle ? <p className={styles.meta}>{subtitle}</p> : null}

        <div className={styles.footer}>
          <span className={styles.modified}>
            <Clock size={13} strokeWidth={2} aria-hidden />
            {formatRelativeTime(project.updated_at)}
          </span>
          <Link className={styles.open} to={`/projects/${project.id}`}>
            Abrir
            <ArrowRight size={14} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      </div>

      {onDelete ? (
        <button
          type="button"
          className={styles.delete}
          aria-label="Eliminar"
          title="Eliminar proyecto"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete(project);
          }}
        >
          <Trash2 size={15} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
    </article>
  );
}
