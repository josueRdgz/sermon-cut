import { Pause, Play } from 'lucide-react';

import { formatDuration } from '../../utils/format';
import type { PreviewMode } from './PreviewMonitor';

interface PreviewTransportProps {
  outputTime: number;
  totalDuration: number;
  previewing: boolean;
  previewMuted: boolean;
  assembledBusy: boolean;
  previewMode: PreviewMode;
  voiceVolume: number;
  musicVolume: number;
  musicVolumeSaving: boolean;
  musicSliderDisabled: boolean;
  dualMonitors: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onToggleMute: () => void;
  onVoiceVolume: (value: number) => void;
  onMusicVolume: (value: number) => void;
  onMusicVolumeCommit: (value: number) => void;
  onPreviewMode: (mode: PreviewMode) => void;
  onDualMonitors: (enabled: boolean) => void;
}

export function PreviewTransport({
  outputTime,
  totalDuration,
  previewing,
  previewMuted,
  assembledBusy,
  previewMode,
  voiceVolume,
  musicVolume,
  musicVolumeSaving,
  musicSliderDisabled,
  dualMonitors,
  onTogglePlay,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onToggleMute,
  onVoiceVolume,
  onMusicVolume,
  onMusicVolumeCommit,
  onPreviewMode,
  onDualMonitors,
}: PreviewTransportProps) {
  const duration = Math.max(totalDuration, 0.01);
  return (
    <div className="reel-nle__dock">
      <div className="reel-nle__transport">
        <button
          type="button"
          className="reel-nle__play"
          onClick={onTogglePlay}
          aria-label={previewing ? 'Pausar' : 'Reproducir'}
        >
          {previewing ? (
            <Pause size={16} strokeWidth={2.2} aria-hidden />
          ) : (
            <Play size={16} strokeWidth={2.2} aria-hidden />
          )}
          <span>{previewing ? 'Pausar' : 'Reproducir'}</span>
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
        <div className="reel-nle__preview-mode" role="group" aria-label="Modo de vista previa">
          <button
            type="button"
            className={`button button--secondary${
              previewMode === 'logical' ? ' button--pressed' : ''
            }`}
            aria-pressed={previewMode === 'logical'}
            disabled={assembledBusy}
            onClick={() => void onPreviewMode('logical')}
          >
            Lógica
          </button>
          <button
            type="button"
            className={`button button--secondary${
              previewMode === 'assembled' ? ' button--pressed' : ''
            }`}
            aria-pressed={previewMode === 'assembled'}
            disabled={assembledBusy}
            onClick={() => void onPreviewMode('assembled')}
          >
            {assembledBusy ? 'Ensamblando…' : 'Ensamblado'}
          </button>
        </div>
        <button
          type="button"
          className="button button--secondary"
          aria-pressed={previewMuted}
          onClick={onToggleMute}
        >
          {previewMuted ? 'Audio' : 'Silenciar'}
        </button>
        <button
          type="button"
          className="button button--secondary"
          aria-pressed={dualMonitors}
          onClick={() => onDualMonitors(!dualMonitors)}
        >
          {dualMonitors ? 'Un visor' : 'Fuente'}
        </button>
        <span className="muted reel-nle__keys">J K L · I O</span>
      </div>
      <div className="reel-nle__mix">
        <label className="reel-nle__mix-slider">
          <span>Voz</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={previewMuted ? 0 : voiceVolume}
            aria-label="Volumen de la voz"
            onChange={(event) => onVoiceVolume(Number(event.target.value))}
          />
          <em>{Math.round((previewMuted ? 0 : voiceVolume) * 100)}%</em>
        </label>
        <label
          className={`reel-nle__mix-slider${musicSliderDisabled ? ' reel-nle__mix-slider--disabled' : ''}`}
        >
          <span>Música</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={musicVolume}
            disabled={musicSliderDisabled}
            aria-label="Volumen de la música"
            onChange={(event) => onMusicVolume(Number(event.target.value))}
            onPointerUp={(event) =>
              onMusicVolumeCommit(Number((event.target as HTMLInputElement).value))
            }
          />
          <em>
            {musicSliderDisabled
              ? '—'
              : `${Math.round(musicVolume * 100)}%${musicVolumeSaving ? '…' : ''}`}
          </em>
        </label>
      </div>
    </div>
  );
}
