import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProject } from '../api/projects';
import type { Project } from '../types/project';
import { ProjectDetailPage } from './ProjectDetailPage';

vi.mock('../api/projects', () => ({
  getProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteProjectVideo: vi.fn(),
}));

vi.mock('../components/StatusRow', () => ({
  StatusRow: ({ label, value }: { label: string; value: string }) => (
    <div>
      {label}: {value}
    </div>
  ),
}));

vi.mock('../components/TranscriptEditor', () => ({
  TranscriptEditor: () => <div>Panel de transcripción</div>,
}));

vi.mock('../components/AnalysisPanel', () => ({
  AnalysisPanel: ({ onCandidateAccepted }: { onCandidateAccepted: (reelId: string) => void }) => (
    <div>
      Panel de análisis
      <button type="button" onClick={() => onCandidateAccepted('reel-1')}>
        Aceptar propuesta
      </button>
    </div>
  ),
}));

vi.mock('../components/ReelEditor', () => ({
  ReelEditor: () => <div>Panel del editor</div>,
}));

vi.mock('../components/VideoHighlightsPanel', () => ({
  VideoHighlightsPanel: () => <div>Panel de Video Highlights</div>,
}));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

const PROJECT = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'La gracia de Dios',
  preacher_name: 'Juan Pérez',
  bible_reference: 'Efesios 2:8-9',
  church_name: 'Iglesia Central',
  youtube_channel: '@iglesiacentral',
  full_sermon_url: null,
  content_mode: 'both',
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
} satisfies Project;

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[`/projects/${PROJECT.id}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProjectDetailPage workspace', () => {
  beforeEach(() => {
    vi.mocked(getProject).mockResolvedValue(PROJECT);
  });

  it('shows one horizontal category at a time', async () => {
    renderPage();
    await screen.findByRole('heading', { name: PROJECT.title });

    expect(screen.getByRole('tab', { name: /Proyecto Archivo/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Panel de transcripción')).not.toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: /Transcripción Texto/ }));

    expect(screen.getByText('Panel de transcripción')).toBeVisible();
    expect(screen.getByText('Panel del editor')).not.toBeVisible();
  });

  it('opens the editor automatically after accepting an AI proposal', async () => {
    renderPage();
    await screen.findByRole('heading', { name: PROJECT.title });
    fireEvent.click(screen.getByRole('tab', { name: /Análisis IA/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar propuesta' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Editor de Reel/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(screen.getByText('Panel del editor')).toBeVisible();
  });
});
