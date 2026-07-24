import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProjectCard } from '../components/ProjectCard';
import { useProjects } from '../hooks/useProjects';
import type { Project } from '../types/project';

export function ProjectsPage() {
  const { projects, loading, error, remove } = useProjects();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await remove(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="page page--wide">
      <header className="page__header page__header--row">
        <div>
          <p className="eyebrow">
            <Link to="/">Sermon Cut</Link>
          </p>
          <h1>Proyectos</h1>
          <p>Predicaciones locales listas para convertir en Shorts y Reels.</p>
        </div>
        <Link className="button button--inline" to="/projects/new">
          Nueva predicación
        </Link>
      </header>

      {loading && <p className="muted">Cargando proyectos…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && projects.length === 0 && (
        <section className="card empty-state">
          <h2>Aún no hay proyectos</h2>
          <p>Crea tu primera predicación para empezar.</p>
          <Link className="button" to="/projects/new">
            Nueva predicación
          </Link>
        </section>
      )}

      <div className="project-grid">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} onDelete={setPendingDelete} />
        ))}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Eliminar proyecto"
          message={`¿Seguro que quieres eliminar «${pendingDelete.title}»? Se borrarán también el video y la portada del disco.`}
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            if (!deleting) {
              setPendingDelete(null);
              setDeleteError(null);
            }
          }}
        />
      )}
      {deleteError && <p className="error">{deleteError}</p>}
    </main>
  );
}
