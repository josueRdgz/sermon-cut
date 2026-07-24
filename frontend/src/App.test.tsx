import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

const healthPayload = {
  status: 'ok',
  app_name: 'Sermon Cut',
  version: '0.1.0',
  ffmpeg: { available: true, version: '8.1' },
  ffprobe: { available: true, version: '8.1' },
  whisper: { available: true, version: '1.0.0' },
  gemini: { available: false, version: null },
  storage: { bytes_used: 1048576, project_count: 1 },
};

const projectsPayload = {
  items: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'La gracia de Dios',
      preacher_name: 'Juan Pérez',
      bible_reference: 'Efesios 2:8-9',
      church_name: 'Iglesia Central',
      youtube_channel: '@iglesiacentral',
      full_sermon_url: null,
      video_filename: 'original.mp4',
      cover_filename: null,
      has_video: true,
      has_cover: false,
      created_at: '2026-07-24T12:00:00Z',
      updated_at: '2026-07-24T12:00:00Z',
      duration_seconds: 125,
      width: 1920,
      height: 1080,
      fps: 30,
      video_codec: 'h264',
      audio_codec: 'aac',
      resolution: '1920x1080',
      status: 'ready',
      error_message: null,
    },
  ],
  total: 1,
};

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes('/api/projects') ? projectsPayload : healthPayload;
        return Promise.resolve({ ok: true, json: async () => body });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the hero title and the primary action', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'SermonCut' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Nuevo proyecto' }).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByLabelText('Backend: Conectado')).toBeInTheDocument();
    });
  });

  it('shows backend and FFmpeg status once health loads', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText('Backend: Conectado')).toBeInTheDocument();
      expect(screen.getByLabelText('FFmpeg: 8.1')).toBeInTheDocument();
    });
  });
});
