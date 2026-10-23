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
