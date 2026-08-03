import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getHighlightPlan } from '../api/highlights';
import type { HighlightPlan } from '../types/highlight';
import { VideoHighlightsPanel } from './VideoHighlightsPanel';

vi.mock('../api/highlights', () => ({
  cancelHighlightAnalysis: vi.fn(),
  detectSermon: vi.fn(),
  getHighlightAnalysisJob: vi.fn(),
  getHighlightPlan: vi.fn(),
  highlightSrtUrl: vi.fn(),
  renderHighlight: vi.fn(),
  saveHighlightMetadata: vi.fn(),
  saveHighlightReview: vi.fn(),
  startHighlightAnalysis: vi.fn(),
  updateSermonRange: vi.fn(),
}));

vi.mock('../api/renders', () => ({
  cancelRenderJob: vi.fn(),
  getRenderJob: vi.fn(),
  renderOutputUrl: vi.fn(),
}));

const PLAN: HighlightPlan = {
  id: '22222222-2222-2222-2222-222222222222',
  project_id: '11111111-1111-1111-1111-111111111111',
  reel_id: null,
  sermon_start: 600,
  sermon_end: 2400,
  sermon_confidence: 0.91,
  detection_method: 'transcript_gaps_and_continuity',
  detection_notes: 'Intervalo respaldado por continuidad de voz.',
  requires_manual_range: false,
  target_duration_seconds: 300,
  editorial_style: 'balanced',
  subtitle_delivery: 'burned',
  title_theme: null,
  biblical_references: [],
  segments: [],
  estimated_duration_seconds: 0,
  metadata: null,
  regeneration_history: [],
  created_at: '2026-08-03T12:00:00Z',
  updated_at: '2026-08-03T12:00:00Z',
};

describe('VideoHighlightsPanel', () => {
  beforeEach(() => {
    vi.mocked(getHighlightPlan).mockResolvedValue(PLAN);
  });

  it('shows detected sermon times and target duration controls', async () => {
    render(
      <VideoHighlightsPanel
        projectId={PLAN.project_id}
        hasVideo
        hasCover={false}
        videoDuration={3600}
        transcriptRevision={0}
      />,
    );
    await waitFor(() => expect(getHighlightPlan).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Intervalo de la predicación' })).toBeVisible();
    expect(screen.getByDisplayValue('600')).toBeVisible();
    expect(screen.getByRole('option', { name: '5 minutos' })).toBeInTheDocument();
  });
});
