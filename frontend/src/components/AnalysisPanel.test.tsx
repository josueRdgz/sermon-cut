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
});
