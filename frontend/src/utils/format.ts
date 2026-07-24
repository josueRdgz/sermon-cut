import type { ProjectStatus } from '../types/project';

const STATUS_LABELS: Record<ProjectStatus, string> = {
  created: 'Creado',
  importing: 'Importando',
  ready: 'Listo',
  transcribing: 'Transcribiendo',
  analyzing: 'Analizando',
  editing: 'Editando',
  rendering: 'Renderizando',
  completed: 'Completado',
  failed: 'Fallido',
};

export function statusLabel(status: ProjectStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}
