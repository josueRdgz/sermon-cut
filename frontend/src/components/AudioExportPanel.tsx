import { useEffect, useState } from 'react';

import { getBackgroundMusicMeters } from '../api/backgroundMusic';
import type { BackgroundMusicMeters } from '../types/backgroundMusic';

interface AudioExportPanelProps {
  projectId: string;
  normalizeLoudness: boolean;
  onNormalizeChange: (value: boolean) => void;
}

export function AudioExportPanel({
  projectId,
  normalizeLoudness,
  onNormalizeChange,
}: AudioExportPanelProps) {
  const [meters, setMeters] = useState<BackgroundMusicMeters | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBackgroundMusicMeters(projectId)
      .then((data) => {
        if (!cancelled) setMeters(data);
      })
      .catch(() => {
        if (!cancelled) setMeters(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const meterLine = meters
    ? [
        normalizeLoudness ? 'El volumen de la voz se igualará.' : 'El volumen se dejará como está.',
        meters.enabled ? 'La música queda más baja que la voz.' : 'Sin música de fondo.',
        'El audio se exporta limpio.',
      ].join(' ')
    : 'Deja la voz a un volumen constante en el archivo final.';

  return (
    <div className="audio-export-panel">
      <label className="field field--inline field--checkbox">
        <input
          type="checkbox"
          checked={normalizeLoudness}
          onChange={(event) => onNormalizeChange(event.target.checked)}
        />
        <span>Igualar volumen al exportar</span>
      </label>
      <p className="muted">{meterLine}</p>
    </div>
  );
}
