import { useMemo } from 'react';

import type { StatusTone } from '../components/ui/StatusIndicator';
import { formatBytes } from '../utils/format';
import { useHealth } from './useHealth';

export interface SystemIndicator {
  key: string;
  label: string;
  tone: StatusTone;
  detail: string;
}

export interface SystemStatus {
  loading: boolean;
  indicators: SystemIndicator[];
  overall: StatusTone;
  overallLabel: string;
  version: string;
  storageUsed: string;
  storageBytes: number;
}

const OVERALL_LABELS: Record<StatusTone, string> = {
  ok: 'Operativo',
  warn: 'Atención',
  error: 'Con errores',
  idle: 'Comprobando…',
};

export function useSystemStatus(): SystemStatus {
  const { status, data } = useHealth();

  return useMemo(() => {
    const loading = status === 'loading';

    const backendTone: StatusTone = loading ? 'idle' : status === 'ok' ? 'ok' : 'error';
    const toolTone = (available: boolean, optional = false): StatusTone => {
      if (loading) return 'idle';
      if (available) return 'ok';
      return optional ? 'warn' : 'error';
    };

    const indicators: SystemIndicator[] = [
      {
        key: 'backend',
        label: 'Backend',
        tone: backendTone,
        detail: loading ? 'Comprobando…' : status === 'ok' ? 'Conectado' : 'Sin conexión',
      },
      {
        key: 'ffmpeg',
        label: 'FFmpeg',
        tone: toolTone(data?.ffmpeg?.available ?? false),
        detail: data?.ffmpeg?.available
          ? (data.ffmpeg.version ?? 'Disponible')
          : 'No disponible',
      },
      {
        key: 'whisper',
        label: 'Whisper',
        tone: toolTone(data?.whisper?.available ?? false, true),
        detail: data?.whisper?.available
          ? (data.whisper.version ?? 'Disponible')
          : 'No instalado',
      },
      {
        key: 'gemini',
        label: 'Gemini',
        tone: toolTone(data?.gemini?.available ?? false, true),
        detail: data?.gemini?.available ? 'Configurado' : 'Sin configurar',
      },
    ];

    let overall: StatusTone = 'ok';
    if (loading) overall = 'idle';
    else if (indicators.some((i) => i.tone === 'error')) overall = 'error';
    else if (indicators.some((i) => i.tone === 'warn')) overall = 'warn';

    return {
      loading,
      indicators,
      overall,
      overallLabel: OVERALL_LABELS[overall],
      version: data?.version ?? '—',
      storageUsed: formatBytes(data?.storage?.bytes_used),
      storageBytes: data?.storage?.bytes_used ?? 0,
    };
  }, [status, data]);
}
