import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getBackgroundMusic,
  getBackgroundMusicMeters,
  listBackgroundMusicPresets,
  saveBackgroundMusic,
  uploadBackgroundMusic,
} from '../api/backgroundMusic';
import type {
  BackgroundMusicMeters,
  BackgroundMusicPayload,
  BackgroundMusicPreset,
  BackgroundMusicPresetInfo,
  BackgroundMusicScope,
  BackgroundMusicSettings,
} from '../types/backgroundMusic';

interface BackgroundMusicPanelProps {
  projectId: string;
  /** When true, keep meters refreshed for the export panel. */
  showMeters?: boolean;
}

const FALLBACK_PRESETS: BackgroundMusicPresetInfo[] = [
  {
    id: 'none',
    label: 'Ninguna',
    description: 'Sin música de fondo (predeterminado).',
  },
  {
    id: 'end_card_only',
    label: 'Solo pantalla final',
    description: 'La música suena únicamente en la tarjeta de cierre.',
  },
  {
    id: 'very_soft_background',
    label: 'Fondo muy suave',
    description: 'Bed bajo durante todo el Reel con ducking ante la voz.',
  },
];

const RIGHTS_FALLBACK =
  'El usuario es responsable de contar con los derechos necesarios para utilizar este audio.';

export function BackgroundMusicPanel({ projectId, showMeters = true }: BackgroundMusicPanelProps) {
  const [settings, setSettings] = useState<BackgroundMusicSettings | null>(null);
  const [presets, setPresets] = useState<BackgroundMusicPresetInfo[]>(FALLBACK_PRESETS);
  const [meters, setMeters] = useState<BackgroundMusicMeters | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  const reloadMeters = useCallback(async () => {
    if (!showMeters) return;
    try {
      setMeters(await getBackgroundMusicMeters(projectId));
    } catch {
      setMeters(null);
    }
  }, [projectId, showMeters]);

  useEffect(() => {
    listBackgroundMusicPresets()
      .then((data) => setPresets(data.items))
      .catch(() => setPresets(FALLBACK_PRESETS));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getBackgroundMusic(projectId)
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar la música de fondo');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    void reloadMeters();
  }, [reloadMeters, settings?.preset, settings?.volume, settings?.ducking_enabled, settings?.target_lufs]);

  const patch = useCallback(
    async (payload: BackgroundMusicPayload, message: string | null = null) => {
      setBusy(true);
      setError(null);
      try {
        const next = await saveBackgroundMusic(projectId, payload);
        setSettings(next);
        setNotice(message);
        await reloadMeters();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar');
      } finally {
        setBusy(false);
      }
    },
    [projectId, reloadMeters],
  );

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setUploadPercent(0);
    try {
      const next = await uploadBackgroundMusic(projectId, file, setUploadPercent);
      setSettings(next);
      setNotice('Audio guardado en el proyecto. Elige un preset distinto de «Ninguna» para usarlo.');
      await reloadMeters();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el audio');
    } finally {
      setBusy(false);
      setUploadPercent(null);
      if (musicInputRef.current) musicInputRef.current.value = '';
    }
  };

  if (!settings) {
    return (
      <div className="background-music-panel">
        <div className="reel-editor__section-header">
          <h4>Música de fondo</h4>
        </div>
        {error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>}
      </div>
    );
  }

  const rights = settings.rights_warning || RIGHTS_FALLBACK;
  const musicActive = settings.preset !== 'none';

  return (
    <div className="background-music-panel">
      <div className="reel-editor__section-header">
        <h4>Música de fondo</h4>
        <span className={`badge ${settings.enabled ? 'badge--cut' : ''}`}>
          {settings.enabled ? 'Activa' : 'Desactivada'}
        </span>
      </div>

      <p className="muted">
        Opcional y desactivada por defecto. Solo archivos locales (MP3, WAV, M4A, OGG) — sin
        catálogos ni descargas.
      </p>

      <p className="background-music-panel__rights" role="note">
        {rights}
      </p>

      <div className="transcript-toolbar">
        <label className="field field--inline">
          <span>Preset</span>
          <select
            value={settings.preset}
            disabled={busy}
            onChange={(e) =>
              void patch(
                { preset: e.target.value as BackgroundMusicPreset },
                'Preset aplicado',
              )
            }
          >
            {presets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span>Alcance</span>
          <select
            value={settings.scope}
            disabled={busy || settings.preset === 'none'}
            onChange={(e) =>
              void patch({ scope: e.target.value as BackgroundMusicScope }, 'Alcance actualizado')
            }
          >
            <option value="full_reel">Durante todo el Reel</option>
            <option value="end_card_only">Solo pantalla final</option>
          </select>
        </label>
      </div>

      <div className="background-music-panel__upload">
        <input
          ref={musicInputRef}
          type="file"
          accept=".mp3,.wav,.m4a,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/ogg"
          hidden
          onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => musicInputRef.current?.click()}
        >
          {uploadPercent != null ? `Subiendo… ${uploadPercent}%` : 'Subir audio local'}
        </button>
        {settings.music_filename && (
          <>
            <span className="muted">{settings.music_filename}</span>
            <button
              type="button"
              className="button--ghost"
              disabled={busy}
              onClick={() => void patch({ clear_music: true }, 'Audio eliminado')}
            >
              Quitar archivo
            </button>
          </>
        )}
      </div>

      {musicActive && (
        <div className="background-music-panel__controls">
          <label className="field">
            <span>Volumen ({Math.round(settings.volume * 100)}%)</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.volume}
              disabled={busy}
              onChange={(e) => setSettings({ ...settings, volume: Number(e.target.value) })}
              onMouseUp={(e) =>
                void patch({ volume: Number((e.target as HTMLInputElement).value) })
              }
              onTouchEnd={(e) =>
                void patch({ volume: Number((e.target as HTMLInputElement).value) })
              }
            />
          </label>

          <div className="background-music-panel__grid">
            <label className="field">
              <span>Inicio (s)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={settings.start_seconds}
                disabled={busy}
                onChange={(e) =>
                  void patch({ start_seconds: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label className="field">
              <span>Final (s, vacío = archivo)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={settings.end_seconds ?? ''}
                disabled={busy}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  void patch({ end_seconds: raw === '' ? null : Number(raw) });
                }}
              />
            </label>
            <label className="field">
              <span>Fade in (ms)</span>
              <input
                type="number"
                min={0}
                max={15000}
                step={50}
                value={settings.fade_in_ms}
                disabled={busy}
                onChange={(e) => void patch({ fade_in_ms: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>Fade out (ms)</span>
              <input
                type="number"
                min={0}
                max={15000}
                step={50}
                value={settings.fade_out_ms}
                disabled={busy}
                onChange={(e) => void patch({ fade_out_ms: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>Objetivo LUFS</span>
              <input
                type="number"
                min={-24}
                max={-12}
                step={0.5}
                value={settings.target_lufs}
                disabled={busy}
                onChange={(e) => void patch({ target_lufs: Number(e.target.value) })}
              />
            </label>
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={settings.ducking_enabled}
                disabled={busy || settings.scope !== 'full_reel'}
                onChange={(e) => void patch({ ducking_enabled: e.target.checked })}
              />
              <span>Ducking (bajar música con voz)</span>
            </label>
          </div>
        </div>
      )}

      {showMeters && meters && (
        <div className="background-music-panel__meters" aria-live="polite">
          <h5>Medidores antes de exportar</h5>
          <ul>
            <li>
              Objetivo: <strong>{meters.target_lufs.toFixed(1)} LUFS</strong> · TP{' '}
              {meters.true_peak_db.toFixed(1)} dBTP
            </li>
            <li>
              Música: {Math.round(meters.music_volume * 100)}% ({meters.music_volume_db} dB)
              {meters.enabled
                ? ` · ~${Math.abs(meters.estimated_music_under_voice_db)} dB bajo la voz`
                : ''}
            </li>
            <li>{meters.voice_priority_note}</li>
            <li>{meters.normalize_note}</li>
            <li>Clipping: {meters.clipping_risk}</li>
          </ul>
        </div>
      )}

      {notice && <p className="muted">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
