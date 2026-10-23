export type EditorialPresetId = 'youth' | 'meditation' | 'church' | 'teaching' | 'custom';
export type AnalysisOutputKind = 'shorts' | 'highlights';

export const YOUTH_CONTEXT =
  'Estilo juvenil: energía, contraste y pregunta en los primeros 2 segundos; ' +
  'lenguaje directo; una sola idea; cierra con un reto concreto para esta semana; ' +
  'corta rodeos y tono de clase. Sigue siendo fiel a las palabras del predicador.';

export const MEDITATION_CONTEXT =
  'Estilo de meditación: ritmo pausado, deja respirar las frases, prioriza Escritura, ' +
  'adoración y consuelo; evita prisa, chistes o ganchos agresivos; un clip = una verdad ' +
  'para contemplar; cierra en silencio o con una aplicación suave.';

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
  { id: 'youth', label: 'Juvenil', text: YOUTH_CONTEXT },
  { id: 'meditation', label: 'Meditación', text: MEDITATION_CONTEXT },
  { id: 'church', label: 'Iglesia en redes', text: CHURCH_REELS_CONTEXT },
  { id: 'teaching', label: 'Expositivo / enseñanza', text: EXPOSITORY_CONTEXT },
  { id: 'custom', label: 'Personalizado', text: '' },
];

export const ANALYSIS_OUTPUT_PRESETS: Record<
  AnalysisOutputKind,
  { label: string; hint: string; minDuration: number; maxDuration: number; prompt: string }
> = {
  shorts: {
    label: 'Shorts / Reels',
    hint: 'Clips cortos de una idea, listos para vertical.',
    minDuration: 20,
    maxDuration: 45,
    prompt:
      'Formato: Shorts o Reels. Un clip = una idea. Apunta a 20–45 s. Gancho inmediato, frase memorable y cierre con aplicación.',
  },
  highlights: {
    label: 'Highlights',
    hint: 'Resumen más largo con los mejores momentos.',
    minDuration: 90,
    maxDuration: 360,
    prompt:
      'Formato: Video Highlights. Une los mejores momentos en un resumen pastoral de varios minutos, no un Short de 30 s. Conserva el hilo y recorta repeticiones.',
  },
};

export function sourceKindPrompt(sourceKind: 'full_service' | 'sermon_only'): string {
  return sourceKind === 'full_service'
    ? 'Fuente: culto completo. Ignora cantos, anuncios y saludos; prioriza la predicación.'
    : 'Fuente: solo la predicación.';
}

export function extraEditorialInstructions(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function buildAnalysisInstructions(options: {
  outputKind: AnalysisOutputKind;
  sourceKind: 'full_service' | 'sermon_only';
  styleText: string;
}): string {
  return [ANALYSIS_OUTPUT_PRESETS[options.outputKind].prompt, sourceKindPrompt(options.sourceKind), options.styleText.trim()]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 2000);
}
