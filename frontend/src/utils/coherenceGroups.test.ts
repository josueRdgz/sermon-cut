import { describe, expect, it } from 'vitest';

import type { CoherenceIssue } from '../types/coherence';
import { coherenceGroupLabel, groupCoherenceIssues } from './coherenceGroups';

function issue(partial: Partial<CoherenceIssue> & Pick<CoherenceIssue, 'code' | 'segment_id'>): CoherenceIssue {
  return {
    severity: 'blocked',
    message: 'corta la palabra',
    segment_uuid: null,
    recommendation: 'Ajusta el borde',
    dismissed: false,
    ...partial,
  };
}

describe('groupCoherenceIssues', () => {
  it('merges WORD_CUT on both sides of the same join', () => {
    const groups = groupCoherenceIssues([
      issue({ code: 'WORD_CUT', segment_id: 1 }),
      issue({ code: 'WORD_CUT', segment_id: 2 }),
      issue({ code: 'ARTIFICIAL_PAUSE', segment_id: 2, message: 'salto', recommendation: 'fundido' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].issues.map((item) => item.segment_id)).toEqual([1, 2]);
    expect(coherenceGroupLabel(groups[0])).toBe('Fragmentos 1 y 2');
  });
});
