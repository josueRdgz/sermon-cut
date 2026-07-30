import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import { getTranscript, updateSegment } from '../api/transcripts';
import type { Transcript } from '../types/transcript';
import { TranscriptEditor } from './TranscriptEditor';

vi.mock('../api/transcripts', () => ({
  deleteTranscript: vi.fn(),
  getTranscript: vi.fn(),
  projectVideoUrl: vi.fn(() => '/video'),
  transcriptExportUrl: vi.fn(() => '/export'),
  updateSegment: vi.fn(),
  uploadTranscript: vi.fn(),
}));

vi.mock('./TranscriptionPanel', () => ({
  TranscriptionPanel: () => null,
}));

const sampleTranscript: Transcript = {
  id: 't1',
  project_id: 'p1',
  source: 'uploaded_srt',
  language: 'es',
  status: 'ready',
  full_text: 'Hola mundo',
  has_word_timestamps: false,
  created_at: '2026-07-30T12:00:00Z',
  updated_at: '2026-07-30T12:00:00Z',
  segments: [
    {
      id: 's1',
      order: 0,
      start_seconds: 1,
      end_seconds: 4,
      text: 'Hola mundo',
      words: [],
    },
  ],
};

describe('TranscriptEditor timing saves', () => {
  beforeEach(() => {
    vi.mocked(getTranscript).mockResolvedValue(sampleTranscript);
    vi.mocked(updateSegment).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function openEditor() {
    render(<TranscriptEditor projectId="p1" hasVideo={false} videoDuration={60} />);
    expect(await screen.findByText('Hola mundo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Corregir texto' }));
    expect(screen.getByRole('dialog', { name: 'Corregir transcripción' })).toBeInTheDocument();
  }

  it('rejects non-finite start without calling the API', async () => {
    await openEditor();
    const start = screen.getByLabelText('Inicio (s)');
    fireEvent.change(start, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/número finito/i);
    expect(updateSegment).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('rejects start >= end without calling the API', async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText('Inicio (s)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Fin (s)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/menor que el fin/i);
    expect(updateSegment).not.toHaveBeenCalled();
  });

  it('keeps the editor open and clears saving after a network/timeout error', async () => {
    vi.mocked(updateSegment).mockRejectedValue(
      new ApiError('La solicitud tardó demasiado o se canceló. Inténtalo de nuevo.', 0, 'request_timeout'),
    );
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/tardó demasiado/i);
    expect(screen.getByRole('button', { name: 'Guardar corrección' })).not.toBeDisabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ignores a double click on Guardar (single API call)', async () => {
    let resolveSave: (value: Transcript) => void = () => undefined;
    vi.mocked(updateSegment).mockImplementation(
      () =>
        new Promise<Transcript>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await openEditor();
    const save = screen.getByRole('button', { name: 'Guardar corrección' });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(updateSegment).toHaveBeenCalledTimes(1));
    resolveSave(sampleTranscript);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('saves valid timing and refreshes transcript without remounting forever', async () => {
    const updated = {
      ...sampleTranscript,
      segments: [{ ...sampleTranscript.segments[0], start_seconds: 1.5, end_seconds: 3.5 }],
    };
    vi.mocked(updateSegment).mockResolvedValue(updated);
    await openEditor();
    fireEvent.change(screen.getByLabelText('Inicio (s)'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Fin (s)'), { target: { value: '3.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }));
    await waitFor(() => expect(updateSegment).toHaveBeenCalledTimes(1));
    expect(updateSegment).toHaveBeenCalledWith('s1', {
      text: 'Hola mundo',
      start_seconds: 1.5,
      end_seconds: 3.5,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
