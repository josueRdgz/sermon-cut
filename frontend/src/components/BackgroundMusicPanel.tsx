import { useCallback, useEffect, useRef, useState } from 'react';

import {
  backgroundMusicAudioUrl,
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
  BackgroundMusicSettings,
} from '../types/backgroundMusic';

interface BackgroundMusicPanelProps {
  projectId: string;
  /** When true, keep meters refreshed for the export panel. */
  showMeters?: boolean;
  /** Notify the parent when settings change (preview mix, etc.). */
  onSettingsChange?: (settings: BackgroundMusicSettings) => void;
}

const FALLBACK_PRESETS: BackgroundMusicPresetInfo[] = [
  {
    id: 'none',
    label: 'Ninguna',
    description: 'Sin música de fondo (predeterminado).',
  },
  {
    id: 'very_soft_background',
    label: 'Fondo muy suave',
    description: 'Bed bajo durante todo el Reel con ducking ante la voz.',
  },
];

const RIGHTS_FALLBACK =
  'El usuario es responsable de contar con los derechos necesarios para utilizar este audio.';

export function BackgroundMusicPanel({
  projectId,
  showMeters = true,
  onSettingsChange,
}: BackgroundMusicPanelProps) {
  const [settings, setSettings] = useState<BackgroundMusicSettings | null>(null);
  const [presets, setPresets] = useState<BackgroundMusicPresetInfo[]>(FALLBACK_PRESETS);
  const [meters, setMeters] = useState<BackgroundMusicMeters | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement>(null);
  const [audioPreviewKey, setAudioPreviewKey] = useState(() => Date.now().toString());

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
        if (!cancelled) {
          setSettings(data);
          onSettingsChange?.(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar la música de fondo');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, onSettingsChange]);

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
        onSettingsChange?.(next);
        setNotice(message);
        await reloadMeters();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar');
      } finally {
        setBusy(false);
      }
    },
    [projectId, reloadMeters, onSettingsChange],
  );

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setUploadPercent(0);
    try {
      const next = await uploadBackgroundMusic(projectId, file, setUploadPercent);
      setSettings(next);
      onSettingsChange?.(next);
      setAudioPreviewKey(Date.now().toString());
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

  const markCurrentPositionAsStart = async () => {
    const player = audioPreviewRef.current;
    if (!player || !Number.isFinite(player.currentTime)) return;
    const start = Math.round(player.currentTime * 10) / 10;
    await patch({ start_seconds: start }, `Inicio guardado en ${start.toFixed(1)} s`);
  };

  const playFromSavedStart = () => {
    const player = audioPreviewRef.current;
    if (!player) return;
    player.currentTime = settings?.start_seconds ?? 0;
    void player.play().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'No se pudo reproducir la pista');
    });
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
        Puedes usar una pista descargada desde la Biblioteca de audio de YouTube o un archivo
        local (MP3, WAV, M4A u OGG). La música nunca se repite: si termina antes que el Reel, el
        resto queda en silencio.
      </p>

      <p className="background-music-panel__rights" role="note">
        {rights}
      </p>

      <div className="button-stack">
        <a
          className="button-link"
          href="https://www.youtube.com/audiolibrary"
          target="_blank"
          rel="noreferrer"
        >
          Abrir Biblioteca de audio de YouTube
        </a>
        <span className="muted">
          Descarga el MP3 en YouTube Studio y luego selecciónalo aquí. Revisa si la pista exige
          atribución.
        </span>
      </div>

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
          {uploadPercent != null ? `Subiendo… ${uploadPercent}%` : 'Seleccionar pista descargada'}
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

      {settings.music_filename && (
        <div className="background-music-panel__player">
          <strong>Escuchar y elegir el inicio</strong>
          <audio
            key={audioPreviewKey}
            ref={audioPreviewRef}
            controls
            preload="metadata"
            src={backgroundMusicAudioUrl(projectId, audioPreviewKey)}
            onLoadedMetadata={(event) => {
              event.currentTarget.volume = Math.max(0, Math.min(1, settings.volume));
            }}
          >
            Tu navegador no soporta reproducción de audio.
          </audio>
          <div className="button-stack">
            <button type="button" disabled={busy} onClick={() => void markCurrentPositionAsStart()}>
              Usar posición actual como inicio
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy}
              onClick={playFromSavedStart}
            >
              Reproducir desde {settings.start_seconds.toFixed(1)} s
            </button>
          </div>
          <p className="muted">
            Mueve la barra al punto deseado y guárdalo. La exportación comenzará allí y no
            repetirá la pista si llega al final.
          </p>
        </div>
      )}

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
              onChange={(e) => {
                const volume = Number(e.target.value);
                setSettings({ ...settings, volume });
                if (audioPreviewRef.current) {
                  audioPreviewRef.current.volume = Math.max(0, Math.min(1, volume));
                }
              }}
              onPointerUp={(e) =>
                void patch({ volume: Number((e.target as HTMLInputElement).value) })
              }
              onBlur={(e) => void patch({ volume: Number(e.target.value) })}
            />
            <small className="muted">
              Se aplica como volumen real de exportación; el ducking solo lo reduce mientras hay
              voz.
            </small>
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
