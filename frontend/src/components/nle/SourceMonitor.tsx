import { useEffect, useRef, useState } from 'react';

import { projectVideoUrl } from '../../api/projects';
import type { ReelSegment } from '../../types/reel';
import { formatDuration, formatTimecode } from '../../utils/format';

interface SourceMonitorProps {
  projectId: string;
  mediaRevision?: string | number | null;
  sourceTime: number | null;
  sourceDuration: number | null;
  previewing: boolean;
  selectedSegment: ReelSegment | null;
  segments: ReelSegment[];
  onSeekSource: (sourceSeconds: number) => void;
}

export function SourceMonitor({
  projectId,
  mediaRevision = null,
  sourceTime,
  sourceDuration,
  previewing: _previewing,
  selectedSegment,
  segments,
  onSeekSource,
}: SourceMonitorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [probedDuration, setProbedDuration] = useState(0);
  const videoSrc = projectVideoUrl(projectId, mediaRevision);
  const duration = Math.max(sourceDuration ?? 0, probedDuration, 0.01);
  const playhead = sourceTime ?? selectedSegment?.source_start_seconds ?? 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || sourceTime == null) return;
    video.pause();
    if (Math.abs(video.currentTime - sourceTime) > 0.12) {
      video.currentTime = sourceTime;
    }
  }, [sourceTime]);

  function seekFromRatio(clientX: number, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeekSource(ratio * duration);
  }

  return (
    <div className="reel-nle__source">
      <div className="reel-nle__monitor-label">
        <strong>Fuente</strong>
        <span className="muted">Sermón</span>
      </div>
      <div className="reel-player reel-player--landscape reel-nle__source-player">
        <div className="reel-player__stage">
          <video
            ref={videoRef}
            className="reel-player__video"
            src={videoSrc}
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            onLoadedMetadata={(event) => {
              setProbedDuration((event.target as HTMLVideoElement).duration || 0);
            }}
          />
        </div>
      </div>
      <div
        className="reel-nle__source-ruler"
        role="slider"
        aria-label="Posición en el sermón"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={playhead}
        tabIndex={0}
        onPointerDown={(event) => {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          seekFromRatio(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          seekFromRatio(event.clientX, event.currentTarget);
        }}
      >
        {segments.map((segment) => {
          const left = (segment.source_start_seconds / duration) * 100;
          const width =
            (Math.max(0, segment.source_end_seconds - segment.source_start_seconds) / duration) *
            100;
          const selected = segment.id === selectedSegment?.id;
          return (
            <span
              key={segment.id}
              className={`reel-nle__source-span${selected ? ' reel-nle__source-span--selected' : ''}`}
              style={{ left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
            />
          );
        })}
        <span
          className="reel-nle__source-playhead"
          style={{ left: `${Math.max(0, Math.min(100, (playhead / duration) * 100))}%` }}
        />
      </div>
      <p className="muted reel-nle__source-hint">
        {selectedSegment
          ? `Clip ${formatTimecode(selectedSegment.source_start_seconds)} – ${formatTimecode(selectedSegment.source_end_seconds)} · ${formatDuration(selectedSegment.duration_seconds)}`
          : 'Clic en la regla para ir a ese punto del sermón'}
      </p>
    </div>
  );
}
