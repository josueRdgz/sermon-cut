import { Pause, Play, Volume2, VolumeX } from 'lucide-react';

import { formatDuration } from '../../utils/format';

interface PreviewTransportProps {
  outputTime: number;
  totalDuration: number;
  previewing: boolean;
  previewMuted: boolean;
  previewVolume: number;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onToggleMute: () => void;
  onPreviewVolume: (value: number) => void;
}

export function PreviewTransport({
  outputTime,
  totalDuration,
  previewing,
  previewMuted,
  previewVolume,
  onTogglePlay,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onToggleMute,
  onPreviewVolume,
}: PreviewTransportProps) {
  const duration = Math.max(totalDuration, 0.01);
  const silent = previewMuted || previewVolume <= 0;
  const heard = silent ? 0 : previewVolume;
  return (
    <div className="reel-nle__dock">
      <div className="reel-nle__transport">
        <button
          type="button"
          className="reel-nle__play"
          onClick={onTogglePlay}
          aria-label={previewing ? 'Pausar' : 'Reproducir'}
          aria-pressed={previewing}
          title={previewing ? 'Pausar' : 'Reproducir'}
        >
          {previewing ? (
            <Pause size={15} strokeWidth={2.2} aria-hidden />
          ) : (
            <Play size={15} strokeWidth={2.2} aria-hidden />
          )}
        </button>
        <input
          type="range"
          className="reel-nle__scrub"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(outputTime, duration)}
          aria-label="Posición dentro del Reel"
          onChange={(event) => onSeek(Number(event.target.value))}
          onPointerDown={onScrubStart}
          onPointerUp={onScrubEnd}
          onPointerCancel={onScrubEnd}
          onBlur={onScrubEnd}
        />
        <span className="reel-nle__time">
          {formatDuration(outputTime)} / {formatDuration(totalDuration)}
        </span>
      </div>
      <div className="reel-nle__mix">
        <div className="reel-nle__mix-slider">
          <button
            type="button"
            className="reel-nle__mute"
            aria-label={silent ? 'Activar audio' : 'Silenciar'}
            aria-pressed={silent}
            title={silent ? 'Activar audio' : 'Silenciar'}
            onClick={onToggleMute}
          >
            {silent ? (
              <VolumeX size={16} strokeWidth={2.2} aria-hidden />
            ) : (
              <Volume2 size={16} strokeWidth={2.2} aria-hidden />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={heard}
            aria-label="Volumen de la vista previa"
            onChange={(event) => onPreviewVolume(Number(event.target.value))}
          />
          <em>{Math.round(heard * 100)}%</em>
        </div>
      </div>
    </div>
  );
}
