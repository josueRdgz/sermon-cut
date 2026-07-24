import { Clapperboard, Plus } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '../components/ConfirmDialog';
import { AppLayout } from '../components/layout/AppLayout';
import { Sidebar } from '../components/layout/Sidebar';
import { StatusBar } from '../components/layout/StatusBar';
import { TopBar } from '../components/layout/TopBar';
import { ProjectGrid } from '../components/ProjectGrid';
import { EmptyState } from '../components/ui/EmptyState';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { SectionHeader } from '../components/ui/SectionHeader';
import { useProjects } from '../hooks/useProjects';
import { useSystemStatus } from '../hooks/useSystemStatus';
import type { Project } from '../types/project';

export function ProjectsPage() {
  const system = useSystemStatus();
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
    <>
      <AppLayout
        header={
          <TopBar
            indicators={system.indicators}
            actions={
              <PrimaryButton to="/projects/new" size="sm" icon={Plus}>
                Nuevo proyecto
              </PrimaryButton>
            }
          />
        }
        sidebar={<Sidebar />}
        footer={
          <StatusBar
            projectCount={projects.length}
            storageUsed={system.storageUsed}
            version={system.version}
            overall={system.overall}
            overallLabel={system.overallLabel}
          />
        }
      >
        <SectionHeader
          title="Proyectos"
          subtitle="Predicaciones locales listas para convertir en Shorts y Reels."
        />

        {loading ? <p className="muted">Cargando proyectos…</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {!loading && !error && projects.length === 0 ? (
          <EmptyState
            icon={Clapperboard}
            title="Aún no hay proyectos"
            description="Crea tu primer proyecto a partir de un video local o una URL de YouTube."
            action={
              <PrimaryButton to="/projects/new" icon={Plus}>
                Nuevo proyecto
              </PrimaryButton>
            }
          />
        ) : null}

        {projects.length > 0 ? <ProjectGrid projects={projects} onDelete={setPendingDelete} /> : null}

        {deleteError ? <p className="error">{deleteError}</p> : null}
      </AppLayout>

      {pendingDelete ? (
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
      ) : null}
    </>
  );
}
