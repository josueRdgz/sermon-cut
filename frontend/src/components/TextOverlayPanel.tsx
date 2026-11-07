import { useEffect, useState } from 'react';
import { Type } from 'lucide-react';

import { listSubtitleFonts } from '../api/subtitles';
import { overlayTextLabel, type ReelOverlay } from '../types/overlay';
import {
  DEFAULT_TEXT_OVERLAY_STYLE,
  TEXT_FONT_MAX,
  TEXT_FONT_MIN,
  mergeTextOverlayStyle,
  parseTextOverlayStyle,
} from '../utils/textOverlayStyle';
import { TextStyleControls } from './TextStyleControls';

interface TextOverlayPanelProps {
  overlay: ReelOverlay | null;
  busy: boolean;
  onAdd: () => void;
  onChange: (patch: {
    text?: string | null;
    opacity?: number;
    style_json?: string;
  }) => void;
  onDelete: () => void;
}

export function TextOverlayPanel({
  overlay,
  busy,
  onAdd,
  onChange,
  onDelete,
}: TextOverlayPanelProps) {
  const [fonts, setFonts] = useState<string[]>([
    'Helvetica Neue',
    'Helvetica',
    'Arial',
    'Georgia',
    'Times New Roman',
  ]);
  const isText = overlay?.kind === 'text';
  const style = overlay && isText ? parseTextOverlayStyle(overlay) : DEFAULT_TEXT_OVERLAY_STYLE;

  useEffect(() => {
    listSubtitleFonts()
      .then((data) => {
        const families = data.items.map((item) => item.family);
        if (families.length > 0) setFonts(families);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="text-overlay-panel">
      <button
        type="button"
        className="text-overlay-panel__add"
        disabled={busy}
        onClick={onAdd}
      >
        <Type size={15} strokeWidth={2.1} aria-hidden />
        Añadir texto
      </button>
      {isText && overlay ? (
        <>
          <label className="field">
            <textarea
              rows={3}
              value={overlayTextLabel(overlay.text, '')}
              disabled={busy}
              placeholder="Escribe el texto"
              aria-label="Contenido del recuadro"
              onChange={(event) => onChange({ text: event.target.value })}
            />
          </label>
          <TextStyleControls
            fonts={fonts}
            disabled={busy}
            fontSizeMin={TEXT_FONT_MIN}
            fontSizeMax={TEXT_FONT_MAX}
            value={{
              fontFamily: style.font_family,
              fontSize: style.font_size,
              bold: style.bold,
              italic: style.italic,
              underline: style.underline,
              strikethrough: style.strikethrough,
              opacity: overlay.opacity,
            }}
            onChange={(patch) => {
              if (patch.opacity != null) onChange({ opacity: patch.opacity });
              const stylePatch = {
                ...(patch.fontFamily != null ? { font_family: patch.fontFamily } : {}),
                ...(patch.fontSize != null ? { font_size: patch.fontSize } : {}),
                ...(patch.bold != null ? { bold: patch.bold } : {}),
                ...(patch.italic != null ? { italic: patch.italic } : {}),
                ...(patch.underline != null ? { underline: patch.underline } : {}),
                ...(patch.strikethrough != null ? { strikethrough: patch.strikethrough } : {}),
              };
              if (Object.keys(stylePatch).length > 0) {
                onChange({ style_json: mergeTextOverlayStyle(overlay, stylePatch) });
              }
            }}
          />
          <button
            type="button"
            className="button button--danger button--inline"
            disabled={busy}
            onClick={onDelete}
          >
            Eliminar
          </button>
        </>
      ) : (
        <p className="muted text-overlay-panel__empty">
          Selecciona un recuadro en la línea de tiempo para editar tipografía, tamaño y estilo.
        </p>
      )}
    </div>
  );
}
