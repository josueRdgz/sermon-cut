import type { CoherenceIssue } from '../types/coherence';

export interface CoherenceIssueGroup {
  key: string;
  issues: CoherenceIssue[];
}

/** Group the same editorial problem at a join (e.g. WORD_CUT on both sides). */
export function groupCoherenceIssues(issues: CoherenceIssue[]): CoherenceIssueGroup[] {
  const map = new Map<string, CoherenceIssue[]>();
  for (const issue of issues) {
    const key =
      issue.code === 'WORD_CUT'
        ? `WORD_CUT|${issue.recommendation}`
        : `${issue.code}|${issue.segment_id}|${issue.message}`;
    const list = map.get(key) ?? [];
    list.push(issue);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, grouped]) => ({ key, issues: grouped }));
}

export function coherenceGroupLabel(group: CoherenceIssueGroup): string {
  const ids = [...new Set(group.issues.map((issue) => issue.segment_id))].sort((a, b) => a - b);
  if (ids.length === 1) return `Fragmento ${ids[0]}`;
  if (ids.length === 2) return `Fragmentos ${ids[0]} y ${ids[1]}`;
  return `Fragmentos ${ids.join(', ')}`;
}

const ISSUE_CODE_LABEL: Record<string, string> = {
  WORD_CUT: 'Palabra cortada',
  DANGLING_CONNECTOR: 'Conector suelto',
  INCOMPLETE_ENDING: 'Final incompleto',
  UNANSWERED_QUESTION: 'Pregunta sin respuesta',
  MISSING_ANTECEDENT: 'Referencia sin antecedente',
  ABRUPT_TOPIC_CHANGE: 'Cambio de tema brusco',
  DANGLING_REFERENCE: 'Referencia suelta',
  ARTIFICIAL_PAUSE: 'Pausa artificial',
  VOLUME_JUMP: 'Salto de volumen',
  JOIN_NOISE_OR_SILENCE: 'Ruido o silencio en el empalme',
  FRAMING_JUMP: 'Salto de plano',
  AI_REVIEW_UNAVAILABLE: 'Revisión IA no disponible',
  AI_MEANING_RISK: 'Riesgo de significado',
};

export function coherenceIssueLabel(code: string): string {
  return ISSUE_CODE_LABEL[code] ?? code.replace(/_/g, ' ').toLowerCase();
}
