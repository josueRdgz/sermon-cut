import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLatestAnalysis } from '../api/analysis';
import { ApiError } from '../api/client';
import { getTranscript } from '../api/transcripts';
import type { Transcript } from '../types/transcript';
import { AnalysisPanel } from './AnalysisPanel';

vi.mock('../api/analysis', () => ({
  acceptAnalysisCandidate: vi.fn(),
  cancelAnalysisJob: vi.fn(),
  getAnalysisJob: vi.fn(),
  getAnalysisProviderStatus: vi.fn().mockResolvedValue({
    requested: 'auto',
    active: 'mock',
    gemini_configured: false,
    gemini_model: 'gemini-2.5-flash',
    gemini_sdk_installed: false,
    optional: true,
  }),
  getLatestAnalysis: vi.fn(),
  rejectAnalysisCandidate: vi.fn(),
  startAnalysis: vi.fn(),
}));

vi.mock('../api/transcripts', () => ({
  getTranscript: vi.fn(),
}));

const readyTranscript: Transcript = {
  id: 'transcript-1',
  project_id: 'project-1',
  source: 'whisper',
  language: 'es',
  status: 'ready',
  full_text: 'La gracia de Dios.',
  has_word_timestamps: true,
  created_at: '2026-07-29T12:00:00Z',
  updated_at: '2026-07-29T12:00:00Z',
  segments: [
    {
      id: 'segment-1',
      order: 0,
      start_seconds: 0,
      end_seconds: 4,
      text: 'La gracia de Dios.',
      words: [],
    },
  ],
};

describe('AnalysisPanel', () => {
  beforeEach(() => {
    vi.mocked(getTranscript).mockReset();
    vi.mocked(getLatestAnalysis).mockRejectedValue(
      new ApiError('No analysis job found.', 404, 'job_not_found'),
    );
  });

  it('rechecks transcript availability when its revision changes', async () => {
    vi.mocked(getTranscript)
      .mockRejectedValueOnce(new ApiError('Transcript not found.', 404, 'transcript_not_found'))
      .mockResolvedValueOnce(readyTranscript);

    const { rerender } = render(<AnalysisPanel projectId="project-1" transcriptRevision={0} />);

    expect(
      await screen.findByText('Importa o genera una transcripción sincronizada para analizar.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar análisis' })).not.toBeInTheDocument();

    rerender(<AnalysisPanel projectId="project-1" transcriptRevision={1} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar análisis' })).toBeInTheDocument();
    });
    expect(getTranscript).toHaveBeenCalledTimes(2);
  });

  it('shows completed proposals in a vertical list', async () => {
    vi.mocked(getTranscript).mockResolvedValue(readyTranscript);
    vi.mocked(getLatestAnalysis).mockResolvedValue({
      id: 'job-1',
      project_id: 'project-1',
      status: 'completed',
      stage: 'completed',
      provider: 'mock',
      max_reels: 5,
      min_duration_seconds: 20,
      max_duration_seconds: 60,
      additional_instructions: null,
      doctrinal_orientation: null,
      progress: 1,
      chunk_count: 1,
      chunks_completed: 1,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      rejected_count: 0,
      notice: null,
      error_message: null,
      created_at: '2026-11-03T00:00:00Z',
      updated_at: '2026-11-03T00:00:00Z',
      started_at: null,
      finished_at: null,
      candidates: [
        {
          id: 'cand-1',
          job_id: 'job-1',
          project_id: 'project-1',
          rank: 0,
          status: 'pending',
          title: 'La gracia basta',
          hook: 'Gancho',
          summary: 'Resumen',
          editorial_score: 8,
          confidence: 0.9,
          joined_script: null,
          caption: null,
          hashtags: [],
          suggested_titles: {},
          thumbnail_text: null,
          keywords: [],
          segments: [
            {
              start: 0,
              end: 8,
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
        },
      ],
    });

    render(
      <AnalysisPanel
        projectId="project-1"
        transcriptRevision={1}
        onOpenEditor={() => undefined}
      />,
    );

    expect(await screen.findByText('Propuestas del análisis')).toBeInTheDocument();
    expect(screen.getByText('1. La gracia basta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir propuestas en el editor' })).toBeInTheDocument();
  });
});
