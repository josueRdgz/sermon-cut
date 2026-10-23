import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import {
  clearTracking,
  computeTracking,
  framingPreviewImageUrl,
  getFramingPreview,
  getFramingStatus,
  setFramingMode,
  setManualCrop,
} from '../api/framing';
import { updateReel } from '../api/reels';
import type { FramingMode, FramingPreview, FramingStatus, TrackingReport } from '../types/framing';
import type { AspectRatio, Reel, ReelSegment } from '../types/reel';
import { quantizeFramingPreviewTime } from '../utils/framingPreview';

interface FramingPanelProps {
  projectId: string;
  reel: Reel;
  sourceTime: number | null;
  onReelChange: (reel: Reel) => void;
  /** Smaller preview for the NLE inspector. */
  compact?: boolean;
  /** When false the panel is hidden: do not hit FFmpeg for stills. */
  active?: boolean;
}

const MODE_OPTIONS: { value: FramingMode; label: string }[] = [
  { value: 'auto_track', label: 'Seguimiento automático' },
  { value: 'center_crop', label: 'Recorte central fijo' },
  { value: 'blurred_background', label: 'Fondo desenfocado' },
  { value: 'manual', label: 'Posición manual' },
];

const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '9:16', label: 'Short (9:16)' },
  { value: '16:9', label: 'Pantalla completa (16:9)' },
  { value: '1:1', label: 'Cuadrado (1:1)' },
];

export function FramingPanel({
  projectId,
  reel,
  sourceTime,
  onReelChange,
  compact = false,
  active = true,
}: FramingPanelProps) {
  const [status, setStatus] = useState<FramingStatus | null>(null);
  const [report, setReport] = useState<TrackingReport | null>(null);
  const [preview, setPreview] = useState<FramingPreview | null>(null);
  const [aspectBusy, setAspectBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const busy = aspectBusy || actionBusy;
  const [error, setError] = useState<string | null>(null);
  const [manualSegmentId, setManualSegmentId] = useState<string>(reel.segments[0]?.id ?? '');
  const [manualX, setManualX] = useState(0.5);
  const [manualY, setManualY] = useState(0.45);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  );

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
    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const segment = reel.segments.find((item) => item.id === manualSegmentId) ?? reel.segments[0];
    if (!segment) return;
    setManualSegmentId(segment.id);
    setManualX(segment.manual_crop_x ?? 0.5);
    setManualY(segment.manual_crop_y ?? 0.45);
  }, [reel.segments, manualSegmentId]);

  useEffect(() => {
    // Compact inspector has no still; hidden tabs must not extract JPEGs while
    // the program monitor plays (Safari then reports "Load failed").
    if (!active || compact || sourceTime == null || !tabVisible) return;
    const quantized = quantizeFramingPreviewTime(sourceTime);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      getFramingPreview(projectId, reel.id, quantized, undefined, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setPreview(data);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof ApiError && err.code === 'request_cancelled') return;
          setPreview(null);
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, compact, projectId, reel.id, sourceTime, status?.framing_mode, status?.has_cache, tabVisible]);

  const handleAspect = async (aspect: AspectRatio) => {
    setAspectBusy(true);
    setError(null);
    try {
      onReelChange(await updateReel(projectId, reel.id, { aspect_ratio: aspect }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el formato');
    } finally {
      setAspectBusy(false);
    }
  };

  const handleMode = async (mode: FramingMode) => {
    setActionBusy(true);
    setError(null);
    try {
      const next = await setFramingMode(projectId, reel.id, mode);
      setStatus(next);
      onReelChange({ ...reel, framing_mode: mode });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el encuadre');
    } finally {
      setActionBusy(false);
    }
  };

  const handleTrack = async () => {
    setActionBusy(true);
    setError(null);
    try {
      await computeTracking(projectId, reel.id);
      onReelChange({ ...reel, framing_mode: 'auto_track' });
      const started = Date.now();
      while (Date.now() - started < 8 * 60 * 1000) {
        const next = await getFramingStatus(projectId, reel.id);
        setStatus(next);
        if (next.tracking_status === 'failed') {
          setError(next.tracking_error || 'No se pudo calcular el tracking');
          break;
        }
        if (next.tracking_report) {
          setReport(next.tracking_report);
        }
        if (next.tracking_status === 'completed' || (next.has_cache && next.tracking_status !== 'queued' && next.tracking_status !== 'running')) {
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo calcular el tracking');
    } finally {
      setActionBusy(false);
    }
  };

  const handleClear = async () => {
    setActionBusy(true);
    setError(null);
    try {
      setStatus(await clearTracking(projectId, reel.id));
      setReport(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar el tracking');
    } finally {
      setActionBusy(false);
    }
  };

  const handleManualSave = async () => {
    if (!manualSegmentId) return;
    setActionBusy(true);
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
      setActionBusy(false);
    }
  };

  const mode = status?.framing_mode ?? (reel.framing_mode as FramingMode) ?? 'center_crop';

  return (
    <div className={`framing-panel${compact ? ' framing-panel--compact' : ''}`}>
      <div className="reel-editor__section-header">
        <h4>{compact ? 'Encuadre' : 'Encuadre de salida'}</h4>
        {status?.has_cache && <span className="badge badge--cut">Tracking en caché</span>}
      </div>
      <p className="muted">
        {compact
          ? 'Elige Short o pantalla completa. El visor Programa usa este formato.'
          : 'Elige si el video sale en vertical (Short) o a pantalla completa. El seguimiento mantiene al predicador dentro del recorte.'}
      </p>

      <fieldset className="field" style={{ border: 'none', padding: 0 }}>
        <span>Formato de salida</span>
        <div
          className={`source-toggle${compact ? ' source-toggle--compact' : ''}`}
          role="radiogroup"
          aria-label="Formato de salida"
        >
          {ASPECT_OPTIONS.map((option) => (
            <label className="source-toggle__option" key={option.value}>
              <input
                type="radio"
                name={`framing-aspect-${reel.id}`}
                value={option.value}
                checked={reel.aspect_ratio === option.value}
                disabled={aspectBusy}
                onChange={() => void handleAspect(option.value)}
              />
              <span>
                {option.label}
                <small>
                  {option.value === '9:16'
                    ? 'El visor Programa recorta a Short.'
                    : option.value === '16:9'
                      ? 'Pantalla completa, sin recorte vertical.'
                      : 'Cuadro 1:1.'}
                </small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
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
          {status?.tracking_status === 'queued'
            ? 'En cola…'
            : status?.tracking_status === 'running'
              ? 'Calculando…'
              : aspectBusy
                ? 'Guardando…'
                : 'Calcular / recalcular tracking'}
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
