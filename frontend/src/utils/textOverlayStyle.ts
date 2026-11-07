import type { ReelOverlay } from '../types/overlay';

export interface TextOverlayStyle {
  font_family: string;
  font_size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

export const TEXT_FONT_MIN = 20;
export const TEXT_FONT_MAX = 400;

export const DEFAULT_TEXT_OVERLAY_STYLE: TextOverlayStyle = {
  font_family: 'Helvetica Neue',
  font_size: 52,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
};

export function clampTextFontSize(size: number): number {
  return Math.max(TEXT_FONT_MIN, Math.min(TEXT_FONT_MAX, Math.round(size)));
}

export function parseTextOverlayStyle(overlay: Pick<ReelOverlay, 'style_json'>): TextOverlayStyle {
  const style = { ...DEFAULT_TEXT_OVERLAY_STYLE };
  if (!overlay.style_json) return style;
  try {
    const parsed = JSON.parse(overlay.style_json) as Record<string, unknown>;
    if (typeof parsed.font_family === 'string' && parsed.font_family.trim()) {
      style.font_family = parsed.font_family.trim();
    }
    if (typeof parsed.font_size === 'number' && parsed.font_size > 0) {
      style.font_size = clampTextFontSize(parsed.font_size);
    }
    for (const key of ['bold', 'italic', 'underline', 'strikethrough'] as const) {
      if (typeof parsed[key] === 'boolean') style[key] = parsed[key];
    }
  } catch {
    return style;
  }
  return style;
}

export function mergeTextOverlayStyle(
  overlay: Pick<ReelOverlay, 'style_json'>,
  patch: Partial<TextOverlayStyle>,
): string {
  let current: Record<string, unknown> = {};
  if (overlay.style_json) {
    try {
      const parsed = JSON.parse(overlay.style_json) as unknown;
      if (parsed && typeof parsed === 'object') current = parsed as Record<string, unknown>;
    } catch {
      current = {};
    }
  }
  return JSON.stringify({ ...current, ...parseTextOverlayStyle(overlay), ...patch });
}

export function textDecorationCss(style: {
  underline?: boolean;
  strikethrough?: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (style.underline) parts.push('underline');
  if (style.strikethrough) parts.push('line-through');
  return parts.length > 0 ? parts.join(' ') : undefined;
}
