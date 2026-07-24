import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

const healthPayload = {
  status: 'ok',
  app_name: 'Sermon Cut',
  ffmpeg: { available: true, version: '8.1' },
  ffprobe: { available: true, version: '8.1' },
};

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => healthPayload,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the title and a disabled "Crear proyecto" button', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Sermon Cut' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear proyecto' })).toBeDisabled();
  });

  it('shows backend and FFmpeg status once health loads', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Conectado')).toBeInTheDocument();
      expect(screen.getByText('Disponible')).toBeInTheDocument();
      expect(screen.getByText('8.1')).toBeInTheDocument();
    });
  });
});
