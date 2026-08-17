import { useCallback, useEffect, useState } from 'react';

import {
  clearTracking,
  computeTracking,
  framingPreviewImageUrl,
  getFramingPreview,
  getFramingStatus,
  setFramingMode,
  setManualCrop,
} from '../api/framing';
import type { FramingMode, FramingPreview, FramingStatus, TrackingReport } from '../types/framing';
import type { Reel, ReelSegment } from '../types/reel';

interface FramingPanelProps {
  projectId: string;
  reel: Reel;
  sourceTime: number | null;
  onReelChange: (reel: Reel) => void;
  /** Smaller preview for the NLE inspector. */
  compact?: boolean;
}

const MODE_OPTIONS: { value: FramingMode; label: string }[] = [
  { value: 'auto_track', label: 'Seguimiento automático' },
  { value: 'center_crop', label: 'Recorte central fijo' },
  { value: 'blurred_background', label: 'Fondo desenfocado' },
  { value: 'manual', label: 'Posición manual' },
];

export function FramingPanel({
  projectId,
  reel,
  sourceTime,
  onReelChange,
  compact = false,
}: FramingPanelProps) {
  const [status, setStatus] = useState<FramingStatus | null>(null);
  const [report, setReport] = useState<TrackingReport | null>(null);
  const [preview, setPreview] = useState<FramingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualSegmentId, setManualSegmentId] = useState<string>(reel.segments[0]?.id ?? '');
  const [manualX, setManualX] = useState(0.5);
  const [manualY, setManualY] = useState(0.45);

  const reload = useCallback(async () => {
    try {
      setStatus(await getFramingStatus(projectId, reel.id));
    } catch {
      setStatus(null);
    }
  }, [projectId, reel.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const segment = reel.segments.find((item) => item.id === manualSegmentId) ?? reel.segments[0];
    if (!segment) return;
    setManualSegmentId(segment.id);
    setManualX(segment.manual_crop_x ?? 0.5);
    setManualY(segment.manual_crop_y ?? 0.45);
  }, [reel.segments, manualSegmentId]);

  useEffect(() => {
    if (sourceTime == null) return;
    let cancelled = false;
    getFramingPreview(projectId, reel.id, sourceTime)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reel.id, sourceTime, status?.framing_mode, status?.has_cache]);

  const handleMode = async (mode: FramingMode) => {
    setBusy(true);
    setError(null);
    try {
      const next = await setFramingMode(projectId, reel.id, mode);
      setStatus(next);
      onReelChange({ ...reel, framing_mode: mode });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el encuadre');
    } finally {
      setBusy(false);
    }
  };

  const handleTrack = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await computeTracking(projectId, reel.id);
      setReport(next);
      await reload();
      onReelChange({ ...reel, framing_mode: 'auto_track' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo calcular el tracking');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await clearTracking(projectId, reel.id));
      setReport(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar el tracking');
    } finally {
      setBusy(false);
    }
  };

  const handleManualSave = async () => {
    if (!manualSegmentId) return;
    setBusy(true);
    setError(null);
    try {
      await setManualCrop(projectId, reel.id, manualSegmentId, {
        x: manualX,
        y: manualY,
        zoom: 1,
      });
      const segments = reel.segments.map((segment) =>
        segment.id === manualSegmentId
          ? { ...segment, manual_crop_x: manualX, manual_crop_y: manualY, manual_crop_zoom: 1 }
          : segment,
      );
      onReelChange({ ...reel, framing_mode: 'manual', segments });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el cuadro manual');
    } finally {
      setBusy(false);
    }
  };

  const mode = status?.framing_mode ?? (reel.framing_mode as FramingMode) ?? 'center_crop';

  return (
    <div className="framing-panel">
      <div className="reel-editor__section-header">
        <h4>{compact ? 'Encuadre' : 'Encuadre vertical'}</h4>
        {status?.has_cache && <span className="badge badge--cut">Tracking en caché</span>}
      </div>
      <p className="muted">
        {compact
          ? 'El visor Programa muestra el recorte 9:16. El MP4 usa este modo.'
          : 'Mantiene al predicador en el área vertical con movimiento suave. El video final lo renderiza FFmpeg con recorte a pantalla completa; OpenCV solo analiza fotogramas dispersos. Los subtítulos se dibujan directamente sobre la imagen, sin añadir franjas ni espacio arriba o abajo.'}
      </p>

      <div className="transcript-toolbar">
        <label className="field field--inline">
          <span>Modo</span>
          <select
            value={mode}
            disabled={busy}
            onChange={(e) => void handleMode(e.target.value as FramingMode)}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void handleTrack()} disabled={busy}>
          {busy ? 'Calculando…' : 'Calcular / recalcular tracking'}
        </button>
        <button type="button" className="button--ghost" onClick={() => void handleClear()} disabled={busy}>
          Borrar caché
        </button>
      </div>

      {report && <p className="muted">{report.summary}</p>}
      {report && report.segments.some((s) => s.unstable) && (
        <p className="muted">
          Fragmentos inestables se degradan a fondo desenfocado en el render.
        </p>
      )}

      {mode === 'manual' && (
        <div className="framing-manual">
          <label className="field field--inline">
            <span>Fragmento</span>
            <select
              value={manualSegmentId}
              onChange={(e) => setManualSegmentId(e.target.value)}
              disabled={busy}
            >
              {reel.segments.map((segment: ReelSegment, index) => (
                <option key={segment.id} value={segment.id}>
                  Fragmento {index + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span>Centro X</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={manualX}
              onChange={(e) => setManualX(Number(e.target.value))}
            />
          </label>
          <label className="field field--inline">
            <span>Centro Y</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={manualY}
              onChange={(e) => setManualY(Number(e.target.value))}
            />
          </label>
          <button type="button" onClick={() => void handleManualSave()} disabled={busy}>
            Guardar cuadro manual
          </button>
        </div>
      )}

      {preview && !compact && (
        <div className={`framing-preview${compact ? ' framing-preview--compact' : ''}`}>
          <div className="framing-preview__meta muted">
            Vista previa · {preview.mode}
            {preview.unstable ? ' · inestable → blur' : ''} · t={preview.source_time.toFixed(2)}s
          </div>
          <div
            className="framing-preview__stage"
            style={{
              aspectRatio: `${preview.canvas_width} / ${preview.canvas_height}`,
            }}
          >
            {preview.preview_filename && (
              <img
                src={framingPreviewImageUrl(projectId, reel.id, preview.preview_filename)}
                alt="Vista previa del encuadre"
                style={{
                  objectPosition: `${(preview.norm_x + preview.norm_w / 2) * 100}% ${
                    (preview.norm_y + preview.norm_h / 2) * 100
                  }%`,
                }}
              />
            )}
            <span className="framing-preview__output-label">Salida {reel.aspect_ratio}</span>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
