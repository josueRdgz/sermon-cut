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

/** Precise source timecode for Reel segments (HH:MM:SS.cs). */
export function formatTimecode(seconds: number | null | undefined, fractionDigits = 2): string {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  const fraction = clamped - Math.floor(clamped);
  const frac = fraction.toFixed(fractionDigits).slice(1); // ".xx"
  return (
    `${String(hours).padStart(2, '0')}:` +
    `${String(minutes).padStart(2, '0')}:` +
    `${String(wholeSeconds).padStart(2, '0')}${frac}`
  );
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const rounded = value >= 100 || exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[exponent]}`;
}

/** Compact relative time in Spanish (e.g. "hace 3 h", "hace 2 días"). */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const months = Math.round(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
  const years = Math.round(months / 12);
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`;
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
