export type EditorialPresetId = 'youth' | 'meditation' | 'church' | 'teaching' | 'custom';
export type AnalysisOutputKind = 'shorts' | 'highlights';

export const YOUTH_CONTEXT =
  'Brief juvenil. Elige UN momento que un joven compartiría ahora mismo. ' +
  'Los primeros 2 segundos deben ser una pregunta, un contraste o una tesis clara; ' +
  'nunca un saludo, un anuncio ni “vamos a ver el siguiente punto”. ' +
  'Habla en segunda persona, con una sola idea pastoral, y cierra con un reto concreto ' +
  'para esta semana (creer, decidir o hacer). Conserva la frase más memorable, lista para subtítulo. ' +
  'Corta rodeos, muletillas y tono de clase. Fidelidad total a las palabras del predicador: ' +
  'exact_text, start y end salen de la transcripción. Prefiere 25–45 s; no superes el máximo pedido.';

export const MEDITATION_CONTEXT =
  'Brief de meditación. Elige un momento para contemplar, no para viralizar. ' +
  'Ritmo pausado: deja respirar la Escritura, la adoración o el consuelo. ' +
  'Empieza en la verdad, no en un gancho agresivo ni en un chiste. ' +
  'Un clip = una afirmación para guardar en el corazón. Cierra en silencio, ' +
  'con una aplicación suave o con la propia frase bíblica. ' +
  'Evita prisa, cortes nerviosos y titulares de debate. ' +
  'Copia el texto real de la transcripción. Prefiere 30–60 s; no superes el máximo.';

export const CHURCH_REELS_CONTEXT =
  'Brief de iglesia en redes. Debe sentirse como un Reel publicado por la congregación, ' +
  'no como un resumen académico del sermón. Engancha en 2 s con tesis, contraste o pregunta. ' +
  'Un clip = una idea. Conserva la frase más citable. Cierra con aplicación concreta ' +
  '(qué creer, qué dejar, qué hacer esta semana). Descarta saludos, cantos, anuncios y transiciones de predicador. ' +
  'Título recommended: 4 a 10 palabras, bíblico, tono de iglesia local; thumbnail_text en 2–5 palabras. ' +
  'Sin clickbait secular ni promesas de prosperidad. Fidelidad literal al predicador. Prefiere 25–60 s.';

export const EXPOSITORY_CONTEXT =
  'Brief expositivo. Prioriza el texto bíblico y el argumento del predicador. ' +
  'El clip debe dejar clara la tesis del pasaje y terminar con una aplicación pastoral, ' +
  'no con emoción suelta. No resumas todos los puntos del sermón: elige el hilo más fiel. ' +
  'Empieza cuando el predicador enuncia o demuestra la tesis; cierra cuando ya se aplicó. ' +
  'Evita saludos, anuncios y rodeos. exact_text debe coincidir con la transcripción. Prefiere 35–70 s.';

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

export const YOUTUBE_SHORT_TOTAL_MAX_SECONDS = 180;
export const DEFAULT_END_CARD_SECONDS = 5;

export function shortsContentMaxSeconds(endCardSeconds: number): number {
  return Math.max(8, YOUTUBE_SHORT_TOTAL_MAX_SECONDS - Math.max(0, endCardSeconds));
}

export const ANALYSIS_OUTPUT_PRESETS: Record<
  AnalysisOutputKind,
  { label: string; hint: string; minDuration: number; maxDuration: number; prompt: string }
> = {
  shorts: {
    label: 'Shorts / Reels',
    hint: 'Una idea, gancho en 2 s. El video publicado no puede pasar de 3 minutos (pantalla final incluida).',
    minDuration: 20,
    maxDuration: shortsContentMaxSeconds(DEFAULT_END_CARD_SECONDS),
    prompt:
      'Formato Shorts/Reels. Devuelve solo clips que un editor publicaría: una idea, gancho audible en 2 s, ' +
      'frase memorable y cierre con aplicación. Apunta a 25–60 s. Si un momento no tiene evidencia en la ' +
      'transcripción, dura de más, empieza en un saludo o corta a media frase, no lo incluyas. ' +
      'Es mejor menos clips válidos que clips que luego hay que tirar. El video completo, con pantalla final si va, no puede pasar de 180 s.',
  },
  highlights: {
    label: 'Highlights',
    hint: 'Resumen más largo con los mejores momentos.',
    minDuration: 90,
    maxDuration: 360,
    prompt:
      'Formato Video Highlights. Une los mejores momentos en un resumen pastoral de varios minutos, ' +
      'conservando el hilo y recortando repeticiones. No lo conviertas en un Short de 30 s. ' +
      'Cada segmento debe existir en la transcripción, con tiempos reales y duración dentro del rango pedido.',
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
    .slice(0, 2400);
}
