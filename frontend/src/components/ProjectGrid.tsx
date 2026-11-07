import { ProjectCard } from './ProjectCard';
import type { Project } from '../types/project';
import styles from './ProjectGrid.module.css';

interface ProjectGridProps {
  projects: Project[];
  onDelete?: (project: Project) => void;
  onUpdated?: (project: Project) => void;
}

export function ProjectGrid({ projects, onDelete, onUpdated }: ProjectGridProps) {
  return (
    <div className={styles.grid}>
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onDelete={onDelete}
          onUpdated={onUpdated}
        />
      ))}
    </div>
  );
}
