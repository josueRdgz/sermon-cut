import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsPage } from './ProjectsPage';

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

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => projectsPayload,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists projects with duration, resolution and status', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('La gracia de Dios')).toBeInTheDocument();
    });
    expect(screen.getByText('2:05')).toBeInTheDocument();
    expect(screen.getByText('1920x1080')).toBeInTheDocument();
    expect(screen.getByText('Listo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
  });
});
