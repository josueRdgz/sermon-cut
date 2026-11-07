import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AnalysisCandidate } from '../types/analysis';
import type { ReelSegment } from '../types/reel';
import {
  addableAnalysisCandidates,
  addedCandidateIdsOnReel,
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

  it('can show only the add-fragment action', () => {
    const onEdit = vi.fn();
    const onAddToReel = vi.fn();
    render(
      <AnalysisProposalList
        compact
        addOnly
        candidates={[candidate()]}
        canAddToReel
        currentReelTitle="Short de prueba"
        onEdit={onEdit}
        onAddToReel={onAddToReel}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Editar esta propuesta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir en el editor' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir fragmento' }));
    expect(onAddToReel).toHaveBeenCalled();
  });

  it('hides the proposal of the reel being edited', () => {
    const current = candidate({
      id: 'a',
      rank: 0,
      title: 'Abierta',
      accepted_reel_id: 'reel-1',
    });
    const other = candidate({ id: 'b', rank: 1, title: 'Otra' });
    render(
      <AnalysisProposalList
        compact
        canAddToReel
        currentReelId="reel-1"
        candidates={[current, other]}
        onEdit={vi.fn()}
        onAddToReel={vi.fn()}
      />,
    );
    expect(screen.queryByText('1. Abierta')).not.toBeInTheDocument();
    expect(screen.getByText('2. Otra')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar esta propuesta' })).toBeInTheDocument();
  });

  it('hides the selected reel proposal when adding fragments', () => {
    const current = candidate({
      id: 'a',
      rank: 0,
      title: 'Abierta',
      accepted_reel_id: 'reel-1',
    });
    const other = candidate({ id: 'b', rank: 1, title: 'Otra' });
    const { rerender } = render(
      <AnalysisProposalList
        compact
        addOnly
        canAddToReel
        currentReelId="reel-1"
        candidates={[current, other]}
        onAddToReel={vi.fn()}
      />,
    );
    expect(screen.queryByText('1. Abierta')).not.toBeInTheDocument();
    expect(screen.getByText('2. Otra')).toBeInTheDocument();

    rerender(
      <AnalysisProposalList
        compact
        addOnly
        canAddToReel
        currentReelId="reel-1"
        candidates={[current]}
        onAddToReel={vi.fn()}
      />,
    );
    expect(screen.queryByText('1. Abierta')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('addableAnalysisCandidates', () => {
  it('drops the open reel and already added proposals', () => {
    const items = addableAnalysisCandidates(
      [
        candidate({ id: 'open', rank: 0, accepted_reel_id: 'reel-1' }),
        candidate({ id: 'added', rank: 1 }),
        candidate({ id: 'other', rank: 2 }),
      ],
      'reel-1',
      ['added'],
    );
    expect(items.map((item) => item.id)).toEqual(['other']);
  });
});

describe('addedCandidateIdsOnReel', () => {
  function clip(
    id: string,
    order: number,
    start: number,
    end: number,
  ): ReelSegment {
    return {
      id,
      reel_id: 'reel-1',
      order,
      source_start_seconds: start,
      source_end_seconds: end,
      duration_seconds: end - start,
      transition_type: 'hard_cut',
      transition_duration_ms: 0,
      transcript_text: null,
    };
  }

  it('marks extra fragments as added until they are deleted', () => {
    const origin = candidate({
      id: 'open',
      rank: 0,
      accepted_reel_id: 'reel-1',
      segments: [{ start: 0, end: 41, exact_text: '', reason: '', match_ratio: 1, snapped: false }],
    });
    const extra = candidate({
      id: 'extra',
      rank: 1,
      segments: [{ start: 9, end: 27, exact_text: '', reason: '', match_ratio: 1, snapped: false }],
    });
    expect(
      addedCandidateIdsOnReel([origin, extra], 'reel-1', [
        clip('a', 0, 0, 41),
        clip('b', 1, 9, 27),
      ]),
    ).toEqual(['extra']);
    expect(addedCandidateIdsOnReel([origin, extra], 'reel-1', [clip('a', 0, 0, 41)])).toEqual([]);
  });
});
