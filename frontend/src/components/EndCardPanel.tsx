import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  endCardPreviewUrl,
  getProjectEndCardSettings,
  listEndCardLayouts,
  saveProjectEndCardSettings,
} from '../api/endCard';
import { uploadProjectCover } from '../api/projects';
import type {
  EndCardLayout,
  EndCardLayoutInfo,
  EndCardMessagePosition,
  EndCardSettings,
  EndCardSettingsPayload,
} from '../types/endCard';
import type { Project } from '../types/project';
import type { AspectRatio } from '../types/reel';

interface EndCardPanelProps {
  projectId: string;
  aspectRatio: AspectRatio;
  hasCover: boolean;
  /** Called after the project cover is uploaded or replaced. */
  onCoverUpdated?: (project: Project) => void;
}

const COVER_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const DEFAULT_MESSAGE = 'Ver sermón completo en nuestro canal de YouTube';
const MESSAGE_POSITIONS: { value: EndCardMessagePosition; label: string }[] = [
  { value: 'top', label: 'Arriba' },
  { value: 'center', label: 'Centro' },
  { value: 'bottom', label: 'Abajo' },
];
const FALLBACK_LAYOUTS: EndCardLayoutInfo[] = [
  {
    id: 'cover_full',
    label: 'Imagen de fondo',
    description: 'La portada ocupa todo el fondo, sin márgenes ni franjas.',
    needs_cover: true,
  },
  {
    id: 'cover_card',
    label: 'Portada en tarjeta',
    description: 'Muestra la imagen completa dentro de una tarjeta con esquinas redondeadas.',
    needs_cover: true,
  },
  {
    id: 'minimal',
    label: 'Minimalista',
    description: 'Muestra la imagen completa en un formato más compacto y sobrio.',
    needs_cover: true,
  },
];

export function EndCardPanel({
  projectId,
  aspectRatio,
  hasCover,
  onCoverUpdated,
}: EndCardPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<EndCardSettings | null>(null);
  const [layouts, setLayouts] = useState<EndCardLayoutInfo[]>(FALLBACK_LAYOUTS);
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverProgress, setCoverProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(() => Date.now().toString());

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProjectEndCardSettings(projectId), listEndCardLayouts()])
      .then(([data, layoutResponse]) => {
        if (!cancelled) {
          setSettings(data);
          setLayouts(layoutResponse.items);
        }
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

  const patchSettings = useCallback(
    async (payload: EndCardSettingsPayload, failureMessage: string) => {
      setBusy(true);
      setError(null);
      try {
        const updated = await saveProjectEndCardSettings(projectId, {
          ...payload,
          audio_mode: 'silence',
          show_qr: false,
          url_text: null,
          channel_handle: null,
        });
        setSettings(updated);
        setPreviewKey(Date.now().toString());
      } catch (err) {
        setError(err instanceof Error ? err.message : failureMessage);
      } finally {
        setBusy(false);
      }
    },
    [projectId],
  );

  const patchMessage = useCallback(
    (message: string | null) =>
      patchSettings({ custom_message: message }, 'No se pudo guardar el mensaje'),
    [patchSettings],
  );

  const patchLayout = useCallback(
    (layout: EndCardLayout) =>
      patchSettings({ layout }, 'No se pudo guardar el diseño de la pantalla final'),
    [patchSettings],
  );

  async function handleCoverFile(file: File | null) {
    if (!file) return;
    setCoverBusy(true);
    setCoverProgress(0);
    setError(null);
    try {
      const updated = await uploadProjectCover(projectId, file, setCoverProgress);
      onCoverUpdated?.(updated);
      setPreviewKey(Date.now().toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la portada');
    } finally {
      setCoverBusy(false);
      setCoverProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const previewSrc = useMemo(
    () =>
      endCardPreviewUrl(projectId, {
        aspectRatio,
        layout: settings?.layout ?? 'cover_full',
        scale: 0.35,
        cacheKey: previewKey,
      }),
    [projectId, aspectRatio, settings?.layout, previewKey],
  );

  if (!settings) {
    return (
      <div className="end-card-panel">
        <div className="reel-editor__section-header">
          <h4>Pantalla final</h4>
        </div>
        {error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>}
      </div>
    );
  }

  const visibleMessage = settings.custom_message ?? DEFAULT_MESSAGE;
  const selectedLayout = layouts.find((layout) => layout.id === settings.layout);

  return (
    <div className="end-card-panel">
      <div className="reel-editor__section-header">
        <h4>Pantalla final</h4>
        <span className="badge badge--required">Obligatoria</span>
      </div>

      <p className="muted">
        Solo muestra la portada de la predicación y el mensaje inferior. No incluye título, nombre,
        URL, identificador del canal, logo ni código QR.
      </p>

      {!hasCover && (
        <p className="warning">
          Sube una portada al proyecto para que la pantalla final pueda mostrar la imagen.
        </p>
      )}

      <div className="end-card-panel__body">
        <div className="end-card-panel__preview">
          <img
            className="end-card-panel__image"
            src={previewSrc}
            alt="Vista previa de la pantalla final"
          />
        </div>

        <div className="end-card-panel__controls">
          <div className="end-card-panel__cover">
            <span>Imagen de portada</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={COVER_ACCEPT}
              hidden
              onChange={(event) => void handleCoverFile(event.target.files?.[0] ?? null)}
            />
            <div className="button-stack">
              <button
                type="button"
                className="button button--inline"
                disabled={busy || coverBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {coverBusy
                  ? `Subiendo… ${coverProgress}%`
                  : hasCover
                    ? 'Cambiar imagen'
                    : 'Subir imagen'}
              </button>
            </div>
            <p className="muted">JPEG, PNG o WebP. Sustituye la portada del proyecto.</p>
          </div>

          <label className="field">
            <span>Diseño</span>
            <select
              value={settings.layout}
              disabled={busy || coverBusy}
              onChange={(event) => void patchLayout(event.target.value as EndCardLayout)}
            >
              {layouts.map((layout) => (
                <option key={layout.id} value={layout.id}>
                  {layout.label}
                  {layout.id === 'cover_full' ? ' (recomendado)' : ''}
                </option>
              ))}
            </select>
          </label>
          {selectedLayout && <p className="muted">{selectedLayout.description}</p>}

          <label className="field">
            <span>Texto debajo de la imagen</span>
            <input
              type="text"
              value={visibleMessage}
              disabled={busy || coverBusy}
              onChange={(event) =>
                setSettings({ ...settings, custom_message: event.target.value })
              }
              onBlur={(event) => {
                const value = event.target.value.trim();
                void patchMessage(value && value !== DEFAULT_MESSAGE ? value : null);
              }}
            />
          </label>

          <label className="field">
            <span>Posición del texto</span>
            <select
              value={settings.message_position ?? 'bottom'}
              disabled={busy || coverBusy}
              onChange={(event) =>
                void patchSettings(
                  { message_position: event.target.value as EndCardMessagePosition },
                  'No se pudo guardar la posición del texto',
                )
              }
            >
              {MESSAGE_POSITIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {settings.custom_message && (
            <button
              type="button"
              className="button--ghost"
              disabled={busy || coverBusy}
              onClick={() => void patchMessage(null)}
            >
              Restaurar texto predeterminado
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
