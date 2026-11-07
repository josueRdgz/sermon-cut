import { FONT_MAX, FONT_MIN } from './SubtitlePreviewOverlay';

export interface TextStyleValue {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  opacity: number;
}

interface TextStyleControlsProps {
  value: TextStyleValue;
  fonts: string[];
  disabled?: boolean;
  fontSizeMin?: number;
  fontSizeMax?: number;
  onChange: (patch: Partial<TextStyleValue>) => void;
}

export function TextStyleControls({
  value,
  fonts,
  disabled = false,
  fontSizeMin = FONT_MIN,
  fontSizeMax = FONT_MAX,
  onChange,
}: TextStyleControlsProps) {
  const families = fonts.includes(value.fontFamily) || !value.fontFamily
    ? fonts
    : [value.fontFamily, ...fonts];

  return (
    <div className="text-style-controls">
      <div className="text-style-controls__type">
        <label className="field">
          <span>Tipografía</span>
          <select
            value={value.fontFamily}
            disabled={disabled}
            onChange={(event) => onChange({ fontFamily: event.target.value })}
          >
            {families.map((family) => (
              <option key={family} value={family} style={{ fontFamily: `"${family}", sans-serif` }}>
                {family}
              </option>
            ))}
          </select>
        </label>
        <div className="text-style-deco" role="group" aria-label="Estilo de letra">
          <button
            type="button"
            className="button button--secondary"
            aria-pressed={value.bold}
            disabled={disabled}
            title="Negrita"
            onClick={() => onChange({ bold: !value.bold })}
          >
            <strong>N</strong>
          </button>
          <button
            type="button"
            className="button button--secondary"
            aria-pressed={value.italic}
            disabled={disabled}
            title="Cursiva"
            onClick={() => onChange({ italic: !value.italic })}
          >
            <em>C</em>
          </button>
          <button
            type="button"
            className="button button--secondary"
            aria-pressed={value.underline}
            disabled={disabled}
            title="Subrayado"
            onClick={() => onChange({ underline: !value.underline })}
          >
            <span className="text-style-deco__underline">S</span>
          </button>
          <button
            type="button"
            className="button button--secondary"
            aria-pressed={value.strikethrough}
            disabled={disabled}
            title="Tachado"
            onClick={() => onChange({ strikethrough: !value.strikethrough })}
          >
            <span className="text-style-deco__strike">T</span>
          </button>
        </div>
      </div>

      <div className="inspector-sliders">
        <label className="inspector-slider">
          <span>Tamaño</span>
          <input
            type="range"
            min={fontSizeMin}
            max={fontSizeMax}
            step={1}
            value={value.fontSize}
            disabled={disabled}
            aria-label="Tamaño de texto"
            onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
          />
          <em>{value.fontSize}px</em>
        </label>
        <label className="inspector-slider">
          <span>Opacidad</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.01}
            value={value.opacity}
            disabled={disabled}
            aria-label="Opacidad de texto"
            onChange={(event) => onChange({ opacity: Number(event.target.value) })}
          />
          <em>{Math.round(value.opacity * 100)}%</em>
        </label>
      </div>
    </div>
  );
}
