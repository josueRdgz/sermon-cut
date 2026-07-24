import { useCallback, useEffect, useState } from 'react';

import { deleteProject, listProjects } from '../api/projects';
import type { Project } from '../types/project';

interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listProjects();
      setProjects(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los proyectos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteProject(id);
    setProjects((current) => current.filter((project) => project.id !== id));
  }, []);

  return { projects, loading, error, refresh, remove };
}
