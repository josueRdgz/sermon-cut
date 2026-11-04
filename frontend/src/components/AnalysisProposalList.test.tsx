import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AnalysisCandidate } from '../types/analysis';
import {
  AnalysisProposalList,
  candidateDuration,
  visibleAnalysisCandidates,
} from './AnalysisProposalList';

function candidate(overrides: Partial<AnalysisCandidate> = {}): AnalysisCandidate {
  return {
    id: 'cand-1',
    job_id: 'job-1',
    project_id: 'project-1',
    rank: 0,
    status: 'pending',
    title: 'La gracia basta',
    hook: 'Un gancho',
    summary: 'Un resumen',
    editorial_score: 8.2,
    confidence: 0.9,
    joined_script: null,
    caption: null,
    hashtags: [],
    suggested_titles: {},
    thumbnail_text: null,
    keywords: [],
    segments: [
      {
        start: 12,
        end: 20,
        exact_text: 'La gracia de Dios.',
        reason: '',
        match_ratio: 1,
        snapped: false,
      },
    ],
    warnings: [],
    removed_context_warning: null,
    accepted_reel_id: null,
    created_at: '2026-11-03T00:00:00Z',
    updated_at: '2026-11-03T00:00:00Z',
    ...overrides,
  };
}

describe('visibleAnalysisCandidates', () => {
  it('hides rejected proposals and keeps rank order', () => {
    const items = visibleAnalysisCandidates([
      candidate({ id: 'b', rank: 1, title: 'Segunda' }),
      candidate({ id: 'a', rank: 0, title: 'Primera' }),
      candidate({ id: 'c', rank: 2, status: 'rejected', title: 'Descartada' }),
    ]);
    expect(items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('sums clip durations', () => {
    expect(candidateDuration(candidate())).toBe(8);
  });
});

describe('AnalysisProposalList', () => {
  it('lists proposals in a single vertical column', () => {
    const { container } = render(
      <AnalysisProposalList
        candidates={[
          candidate({ id: 'a', rank: 0, title: 'Primera' }),
          candidate({ id: 'b', rank: 1, title: 'Segunda' }),
        ]}
      />,
    );
    const list = container.querySelector('.analysis-candidates__list');
    expect(list).toBeTruthy();
    expect(list).not.toHaveClass('analysis-candidates__list--compact');
    expect(screen.getByText('1. Primera')).toBeInTheDocument();
    expect(screen.getByText('2. Segunda')).toBeInTheDocument();
  });

  it('lets you edit a proposal or add it to the current short', () => {
    const onEdit = vi.fn();
    const onAddToReel = vi.fn();
    const first = candidate({ id: 'a', rank: 0, title: 'Primera' });
    render(
      <AnalysisProposalList
        candidates={[first]}
        canAddToReel
        currentReelTitle="Short de prueba"
        onEdit={onEdit}
        onAddToReel={onAddToReel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar esta propuesta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Añadir a «Short de prueba»' }));
    expect(onEdit).toHaveBeenCalledWith(first);
    expect(onAddToReel).toHaveBeenCalledWith(first);
  });
});
