import type { Ref } from 'react';
import { Clapperboard, Minimize2 } from 'lucide-react';

import { backgroundMusicAudioUrl } from '../../api/backgroundMusic';
import { projectVideoUrl } from '../../api/projects';
import type { ReelOverlay } from '../../types/overlay';
import type { AspectRatio, FramingMode, TransitionType } from '../../types/reel';
import { previewObjectPosition, previewVideoFit } from '../../utils/previewFraming';
import { OverlayPreviewLayer } from '../OverlayPreviewLayer';

export type PreviewMode = 'logical' | 'assembled';

interface PreviewMonitorProps {
  projectId: string;
  mediaRevision?: string | number | null;
  aspectRatio: AspectRatio;
  videoRef: Ref<HTMLVideoElement>;
  standbyVideoRef: Ref<HTMLVideoElement>;
  assembledVideoRef: Ref<HTMLVideoElement>;
  activeProgramLane: 0 | 1;
  audioRef: Ref<HTMLAudioElement>;
  audioSrc: string;
  musicRef: Ref<HTMLAudioElement>;
  assembledSrc: string | null;
  previewMode: PreviewMode;
  overlays: ReelOverlay[];
  outputTime: number;
  previewing: boolean;
  previewMuted?: boolean;
  musicFilename: string | null;
  musicActive: boolean;
  onAssembledTime: (seconds: number) => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (overlayId: string) => void;
  onMoveOverlay?: (overlayId: string, x: number, y: number) => void;
  onScaleOverlay?: (overlayId: string, scale: number) => void;
  onTextSizeOverlay?: (overlayId: string, fontSize: number) => void;
  framingMode?: FramingMode | string | null;
  cropX?: number | null;
  cropY?: number | null;
  xfade?: { type: TransitionType; outLane: 0 | 1 } | null;
  incomingCropX?: number | null;
  incomingCropY?: number | null;
  inPad?: boolean;
  onMinimize?: () => void;
  dualMonitors?: boolean;
  onToggleSource?: (enabled: boolean) => void;
}

function aspectClass(aspect: AspectRatio): 'portrait' | 'square' | 'landscape' {
  if (aspect === '9:16') return 'portrait';
  if (aspect === '1:1') return 'square';
  return 'landscape';
}

export function PreviewMonitor({
  projectId,
  mediaRevision = null,
  aspectRatio,
  videoRef,
  standbyVideoRef,
  assembledVideoRef,
  activeProgramLane,
  audioRef,
  audioSrc,
  musicRef,
  assembledSrc,
  previewMode,
  overlays,
  outputTime,
  previewing,
  previewMuted = false,
  musicFilename,
  musicActive,
  onAssembledTime,
  selectedOverlayId = null,
  onSelectOverlay,
  onMoveOverlay,
  onScaleOverlay,
  onTextSizeOverlay,
  framingMode = 'center_crop',
  cropX = 0.5,
  cropY = 0.45,
  xfade = null,
  incomingCropX = null,
  incomingCropY = null,
  inPad = false,
  onMinimize,
  dualMonitors = false,
  onToggleSource,
}: PreviewMonitorProps) {
  const videoSrc = projectVideoUrl(projectId, mediaRevision);
  const videoFit = previewVideoFit(framingMode);
  const outPosition = previewObjectPosition(cropX, cropY);
  const inPosition = previewObjectPosition(incomingCropX ?? cropX, incomingCropY ?? cropY);
  const lane0Out = !xfade || xfade.outLane === 0;
  const lane0Style = {
    objectFit: videoFit,
    objectPosition: lane0Out ? outPosition : inPosition,
  } as const;
  const lane1Style = {
    objectFit: videoFit,
    objectPosition: lane0Out ? inPosition : outPosition,
  } as const;
  const hideLane = (lane: 0 | 1) =>
    inPad || previewMode === 'assembled' || (!xfade && activeProgramLane !== lane);
  const laneClass = (lane: 0 | 1) => {
    const role = xfade ? (xfade.outLane === lane ? 'out' : 'in') : null;
    const idle = hideLane(lane) ? ' reel-player__video--idle' : '';
    return `reel-player__video reel-player__video--${videoFit}${
      role ? ` reel-player__video--${role}` : ''
    }${idle}`;
  };

  return (
    <div className="reel-nle__preview">
      <div className="reel-nle__monitor-label reel-nle__monitor-label--program">
        <strong>Programa</strong>
        <span className="muted">{aspectRatio}</span>
      </div>
      {onMinimize ? (
        <button
          type="button"
          className="reel-nle__preview-minimize"
          data-tooltip="Ocultar vista previa"
          title="Ocultar vista previa"
          aria-label="Ocultar vista previa"
          onClick={onMinimize}
        >
          <Minimize2 size={14} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
      {onToggleSource ? (
        <button
          type="button"
          className={`reel-nle__preview-source${dualMonitors ? ' reel-nle__preview-source--on' : ''}`}
          data-tooltip="Fuente"
          title="Fuente"
          aria-label="Fuente"
          aria-pressed={dualMonitors}
          onClick={() => onToggleSource(!dualMonitors)}
        >
          <Clapperboard size={14} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
      <div className={`reel-player reel-player--${aspectClass(aspectRatio)}`}>
        <div
          className={`reel-player__stage${
            videoFit === 'contain' ? ' reel-player__stage--letterbox' : ''
          }`}
          data-xfade={xfade?.type}
        >
          <video
            ref={videoRef}
            className={laneClass(0)}
            style={lane0Style}
            controls={false}
            disablePictureInPicture
            playsInline
            preload="auto"
            src={videoSrc}
          >
            Tu navegador no soporta video HTML5.
          </video>
          <video
            ref={standbyVideoRef}
            className={laneClass(1)}
            style={lane1Style}
            controls={false}
            disablePictureInPicture
            playsInline
            preload="auto"
            src={videoSrc}
          />
          {assembledSrc && (
            <video
              ref={assembledVideoRef}
              className={`reel-player__video reel-player__video--${videoFit}`}
              style={lane0Style}
              controls={false}
              disablePictureInPicture
              playsInline
              preload="auto"
              src={assembledSrc}
              hidden={previewMode !== 'assembled'}
              onTimeUpdate={(event) => {
                onAssembledTime((event.target as HTMLVideoElement).currentTime);
              }}
            >
              Tu navegador no soporta video HTML5.
            </video>
          )}
          <div className="reel-player__xfade-veil" aria-hidden="true" />
          <div className="reel-player__safe" aria-hidden="true" />
          {previewMode === 'logical' && (
            <OverlayPreviewLayer
              overlays={overlays}
              aspectRatio={aspectRatio}
              outputTime={outputTime}
              previewing={previewing}
              previewMuted={previewMuted}
              selectedOverlayId={selectedOverlayId}
              sourceVideoUrl={videoSrc}
              onSelectOverlay={onSelectOverlay}
              onMoveOverlay={onMoveOverlay}
              onScaleOverlay={onScaleOverlay}
              onTextSizeOverlay={onTextSizeOverlay}
            />
          )}
          <div id="reel-subtitle-overlay" className="reel-player__subtitle-slot" />
          <audio
            ref={audioRef}
            className="reel-player__preview-audio"
            preload="auto"
            src={audioSrc}
            aria-hidden="true"
          />
          {musicActive && musicFilename && (
            <audio
              ref={musicRef}
              className="reel-player__preview-audio"
              preload="auto"
              src={backgroundMusicAudioUrl(projectId, musicFilename)}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </div>
  );
}
