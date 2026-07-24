import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  endCardPreviewUrl,
  getProjectEndCardSettings,
  listEndCardLayouts,
  resetProjectEndCardSettings,
  saveGlobalEndCardSettings,
  saveProjectEndCardSettings,
  uploadEndCardLogo,
  uploadEndCardMusic,
} from '../api/endCard';
import type {
  EndCardAudioMode,
  EndCardLayout,
  EndCardLayoutInfo,
  EndCardSettings,
  EndCardSettingsPayload,
} from '../types/endCard';
import type { AspectRatio } from '../types/reel';

interface EndCardPanelProps {
  projectId: string;
  /** Aspect ratio of the reel being edited, so the preview matches the export. */
  aspectRatio: AspectRatio;
  hasCover: boolean;
}

const AUDIO_OPTIONS: { value: EndCardAudioMode; label: string }[] = [
  { value: 'silence', label: 'Silencio' },
  { value: 'continue_with_fade', label: 'Continuar audio con fade' },
  { value: 'local_music', label: 'Música local (archivo propio)' },
];

const FALLBACK_LAYOUTS: EndCardLayoutInfo[] = [
  {
    id: 'cover_full',
    label: 'Portada completa',
    description: 'La portada llena la pantalla con oscurecimiento.',
    needs_cover: true,
  },
  {
    id: 'cover_card',
    label: 'Portada en tarjeta',
    description: 'La portada dentro de una tarjeta.',
    needs_cover: true,
  },
  {
    id: 'minimal',
    label: 'Minimalista',
    description: 'Fondo limpio con logo y título.',
    needs_cover: false,
  },
];

export function EndCardPanel({ projectId, aspectRatio, hasCover }: EndCardPanelProps) {
  const [settings, setSettings] = useState<EndCardSettings | null>(null);
  const [layouts, setLayouts] = useState<EndCardLayoutInfo[]>(FALLBACK_LAYOUTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  // Bumped after every change so the browser refetches the rendered PNG.
  const [previewKey, setPreviewKey] = useState(() => Date.now().toString());
  const logoInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listEndCardLayouts()
      .then((data) => setLayouts(data.items))
      .catch(() => setLayouts(FALLBACK_LAYOUTS));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getProjectEndCardSettings(projectId)
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'No se pudo cargar la pantalla final');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const apply = useCallback((updated: EndCardSettings, message: string | null = null) => {
    setSettings(updated);
    setPreviewKey(Date.now().toString());
    setNotice(message);
  }, []);

  const patch = useCallback(
    async (payload: EndCardSettingsPayload) => {
      setBusy(true);
      setError(null);
      try {
        apply(await saveProjectEndCardSettings(projectId, payload));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar');
      } finally {
        setBusy(false);
      }
    },
    [projectId, apply],
  );

  const handleSaveAsGlobal = useCallback(async () => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      await saveGlobalEndCardSettings({
        layout: settings.layout,
        duration_seconds: settings.duration_seconds,
        fade_in_ms: settings.fade_in_ms,
        audio_fade_out_ms: settings.audio_fade_out_ms,
        // Music lives per project, so global defaults never carry that mode.
        audio_mode: settings.audio_mode === 'local_music' ? 'silence' : settings.audio_mode,
        show_qr: settings.show_qr,
        custom_message: settings.custom_message,
      });
      setNotice('Guardado como configuración global.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la configuración global');
    } finally {
      setBusy(false);
    }
  }, [settings]);

  const handleReset = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await resetProjectEndCardSettings(projectId), 'Se restauró la configuración global.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restaurar');
    } finally {
      setBusy(false);
    }
  }, [projectId, apply]);

  const handleUpload = useCallback(
    async (kind: 'logo' | 'music', file: File) => {
      setBusy(true);
      setError(null);
      setUploadPercent(0);
      try {
        const upload = kind === 'logo' ? uploadEndCardLogo : uploadEndCardMusic;
        apply(await upload(projectId, file, setUploadPercent));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo subir el archivo');
      } finally {
        setBusy(false);
        setUploadPercent(null);
      }
    },
    [projectId, apply],
  );

  const previewSrc = useMemo(
    () =>
      settings
        ? endCardPreviewUrl(projectId, {
            aspectRatio,
            layout: settings.layout,
            scale: 0.35,
            cacheKey: previewKey,
          })
        : null,
    [projectId, aspectRatio, settings, previewKey],
  );

  const activeLayout = layouts.find((item) => item.id === settings?.layout);
  const coverWarning = activeLayout?.needs_cover && !hasCover;

  return (
    <div className="end-card-panel">
      <div className="reel-editor__section-header">
        <h4>Pantalla final</h4>
        <span className="badge badge--required" title="Se añade a todos los Reels">
          Obligatoria
        </span>
      </div>

      <p className="muted">
        Todo Reel termina con esta pantalla, entre {settings?.min_duration_seconds ?? 3} y{' '}
        {settings?.max_duration_seconds ?? 8} segundos. La imagen se genera con Pillow en el equipo,
        sin navegador.
        {settings && !settings.is_project_override
          ? ' Ahora hereda la configuración global.'
          : ' Esta predicación tiene configuración propia.'}
      </p>

      {!settings && !error && <p className="muted">Cargando configuración…</p>}

      {settings && (
        <>
          <div className="end-card-panel__body">
            <div className="end-card-panel__preview">
              {previewSrc && (
                <img
                  className="end-card-panel__image"
                  src={previewSrc}
                  alt="Vista previa de la pantalla final"
                />
              )}
              <p className="muted">
                {settings.duration_seconds.toFixed(1)} s · fade in {settings.fade_in_ms} ms · fade
                out audio {settings.audio_fade_out_ms} ms
              </p>
            </div>

            <div className="end-card-panel__controls">
              <label className="field">
                <span>Diseño</span>
                <select
                  value={settings.layout}
                  disabled={busy}
                  onChange={(e) => void patch({ layout: e.target.value as EndCardLayout })}
                >
                  {layouts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {activeLayout && <p className="muted">{activeLayout.description}</p>}
              {coverWarning && (
                <p className="warning">
                  Este diseño usa la portada de la predicación y todavía no has subido ninguna.
                </p>
              )}

              <label className="field field--inline">
                <span>Duración</span>
                <input
                  type="range"
                  min={settings.min_duration_seconds}
                  max={settings.max_duration_seconds}
                  step={0.5}
                  value={settings.duration_seconds}
                  disabled={busy}
                  onChange={(e) =>
                    setSettings({ ...settings, duration_seconds: Number(e.target.value) })
                  }
                  onMouseUp={(e) => void patch({ duration_seconds: Number(e.currentTarget.value) })}
                  onKeyUp={(e) => void patch({ duration_seconds: Number(e.currentTarget.value) })}
                />
                <span className="muted">{settings.duration_seconds.toFixed(1)} s</span>
              </label>

              <div className="transcript-toolbar">
                <label className="field field--inline">
                  <span>Fade in</span>
                  <input
                    type="number"
                    min={0}
                    max={3000}
                    step={50}
                    value={settings.fade_in_ms}
                    disabled={busy}
                    onChange={(e) =>
                      setSettings({ ...settings, fade_in_ms: Number(e.target.value) })
                    }
                    onBlur={(e) => void patch({ fade_in_ms: Number(e.target.value) })}
                  />
                  <span className="muted">ms</span>
                </label>
                <label className="field field--inline">
                  <span>Fade out audio</span>
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step={50}
                    value={settings.audio_fade_out_ms}
                    disabled={busy}
                    onChange={(e) =>
                      setSettings({ ...settings, audio_fade_out_ms: Number(e.target.value) })
                    }
                    onBlur={(e) => void patch({ audio_fade_out_ms: Number(e.target.value) })}
                  />
                  <span className="muted">ms</span>
                </label>
              </div>

              <label className="field">
                <span>Audio de la pantalla final</span>
                <select
                  value={settings.audio_mode}
                  disabled={busy}
                  onChange={(e) => void patch({ audio_mode: e.target.value as EndCardAudioMode })}
                >
                  {AUDIO_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.value === 'local_music' && !settings.music_filename}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {settings.audio_mode === 'local_music' && (
                <label className="field field--inline">
                  <span>Volumen música</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.music_volume}
                    disabled={busy}
                    onChange={(e) =>
                      setSettings({ ...settings, music_volume: Number(e.target.value) })
                    }
                    onMouseUp={(e) => void patch({ music_volume: Number(e.currentTarget.value) })}
                  />
                  <span className="muted">{Math.round(settings.music_volume * 100)}%</span>
                </label>
              )}

              <div className="transcript-toolbar">
                <div className="button-stack">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUpload('logo', file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="button--ghost"
                    disabled={busy}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {settings.logo_filename ? 'Cambiar logo' : 'Subir logo (opcional)'}
                  </button>
                </div>
                <div className="button-stack">
                  <input
                    ref={musicInputRef}
                    type="file"
                    accept=".mp3,.m4a,.aac,.wav,.flac,.ogg"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleUpload('music', file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="button--ghost"
                    disabled={busy}
                    onClick={() => musicInputRef.current?.click()}
                  >
                    {settings.music_filename ? 'Cambiar música' : 'Subir música (opcional)'}
                  </button>
                </div>
              </div>
              {uploadPercent != null && <p className="muted">Subiendo… {uploadPercent}%</p>}
              <p className="muted">
                La música debe ser un archivo tuyo; nunca se descarga nada automáticamente.
              </p>

              <label className="field">
                <span>Mensaje (vacío = texto por defecto)</span>
                <input
                  type="text"
                  value={settings.custom_message ?? ''}
                  placeholder="Ver sermón completo en nuestro canal de YouTube"
                  disabled={busy}
                  onChange={(e) => setSettings({ ...settings, custom_message: e.target.value })}
                  onBlur={(e) => void patch({ custom_message: e.target.value.trim() || null })}
                />
              </label>

              <label className="field">
                <span>Identificador del canal (vacío = el del proyecto)</span>
                <input
                  type="text"
                  value={settings.channel_handle ?? ''}
                  placeholder="@micanal"
                  disabled={busy}
                  onChange={(e) => setSettings({ ...settings, channel_handle: e.target.value })}
                  onBlur={(e) => void patch({ channel_handle: e.target.value.trim() || null })}
                />
              </label>

              <label className="field">
                <span>URL visible (vacío = enlace del sermón)</span>
                <input
                  type="text"
                  value={settings.url_text ?? ''}
                  placeholder="youtube.com/@micanal"
                  disabled={busy}
                  onChange={(e) => setSettings({ ...settings, url_text: e.target.value })}
                  onBlur={(e) => void patch({ url_text: e.target.value.trim() || null })}
                />
              </label>

              <label className="field field--inline field--checkbox">
                <input
                  type="checkbox"
                  checked={settings.show_qr}
                  disabled={busy}
                  onChange={(e) => void patch({ show_qr: e.target.checked })}
                />
                <span>Mostrar código QR</span>
              </label>

              {settings.show_qr && (
                <label className="field">
                  <span>URL del QR (vacío = enlace del sermón)</span>
                  <input
                    type="text"
                    value={settings.qr_url ?? ''}
                    placeholder="https://youtube.com/@micanal"
                    disabled={busy}
                    onChange={(e) => setSettings({ ...settings, qr_url: e.target.value })}
                    onBlur={(e) => void patch({ qr_url: e.target.value.trim() || null })}
                  />
                </label>
              )}

              <div className="button-stack">
                <button
                  type="button"
                  className="button--ghost"
                  disabled={busy}
                  onClick={() => void handleSaveAsGlobal()}
                >
                  Guardar como global
                </button>
                {settings.is_project_override && (
                  <button
                    type="button"
                    className="button--ghost"
                    disabled={busy}
                    onClick={() => void handleReset()}
                  >
                    Usar configuración global
                  </button>
                )}
              </div>
            </div>
          </div>

          {notice && <p className="muted">{notice}</p>}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
