export type EditorialPresetId = 'church' | 'teaching' | 'custom';

export const CHURCH_REELS_CONTEXT =
  'Estilo de iglesias que publican Reels con fuerza (como IBSJ y canales similares): ' +
  'engancha en los primeros 2 segundos con tesis, contraste o pregunta; un clip = una idea; ' +
  'conserva la frase más memorable; cierra con aplicación concreta; corta rodeos y saludos; ' +
  'títulos de iglesia, no clickbait secular.';

export const EXPOSITORY_CONTEXT =
  'Prioriza el texto bíblico y el argumento, con una aplicación pastoral clara al final. ' +
  'Evita emoción sin tesis y no resumas todos los puntos.';

export const EDITORIAL_PRESETS: Array<{
  id: EditorialPresetId;
  label: string;
  text: string;
}> = [
  { id: 'church', label: 'Iglesias en redes (tipo IBSJ)', text: CHURCH_REELS_CONTEXT },
  { id: 'teaching', label: 'Más expositivo', text: EXPOSITORY_CONTEXT },
  { id: 'custom', label: 'Personalizado', text: '' },
];

/** Skip the default church preset: the backend already injects house style. */
export function extraEditorialInstructions(preset: EditorialPresetId, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (preset === 'church' && trimmed === CHURCH_REELS_CONTEXT.trim()) return null;
  return trimmed;
}
