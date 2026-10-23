import type { Ref } from 'react';

import { backgroundMusicAudioUrl } from '../../api/backgroundMusic';
import { projectAudioUrl, projectVideoUrl } from '../../api/projects';
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
  musicRef: Ref<HTMLAudioElement>;
  assembledSrc: string | null;
  previewMode: PreviewMode;
  overlays: ReelOverlay[];
  outputTime: number;
  previewing: boolean;
  previewMuted?: boolean;
  musicFilename: string | null;
  musicActive: boolean;
  separateAudio?: boolean;
  onAssembledTime: (seconds: number) => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (overlayId: string) => void;
  onMoveOverlay?: (overlayId: string, x: number, y: number) => void;
  onScaleOverlay?: (overlayId: string, scale: number) => void;
  framingMode?: FramingMode | string | null;
  cropX?: number | null;
  cropY?: number | null;
  xfade?: { type: TransitionType; outLane: 0 | 1 } | null;
  incomingCropX?: number | null;
  incomingCropY?: number | null;
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
  musicRef,
  assembledSrc,
  previewMode,
  overlays,
  outputTime,
  previewing,
  previewMuted = false,
  musicFilename,
  musicActive,
  separateAudio = false,
  onAssembledTime,
  selectedOverlayId = null,
  onSelectOverlay,
  onMoveOverlay,
  onScaleOverlay,
  framingMode = 'center_crop',
  cropX = 0.5,
  cropY = 0.45,
  xfade = null,
  incomingCropX = null,
  incomingCropY = null,
}: PreviewMonitorProps) {
  const videoSrc = projectVideoUrl(projectId, mediaRevision);
  const audioSrc = separateAudio
    ? projectAudioUrl(projectId, mediaRevision)
    : videoSrc;
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
    previewMode === 'assembled' || (!xfade && activeProgramLane !== lane);
  const laneClass = (lane: 0 | 1) => {
    const role = xfade ? (xfade.outLane === lane ? 'out' : 'in') : null;
    return `reel-player__video reel-player__video--${videoFit}${
      role ? ` reel-player__video--${role}` : ''
    }`;
  };

  return (
    <div className="reel-nle__preview">
      <div className="reel-nle__monitor-label reel-nle__monitor-label--program">
        <strong>Programa</strong>
        <span className="muted">{aspectRatio}</span>
      </div>
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
            hidden={hideLane(0)}
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
            hidden={hideLane(1)}
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
              outputTime={outputTime}
              previewing={previewing}
              previewMuted={previewMuted}
              selectedOverlayId={selectedOverlayId}
              sourceVideoUrl={videoSrc}
              onSelectOverlay={onSelectOverlay}
              onMoveOverlay={onMoveOverlay}
              onScaleOverlay={onScaleOverlay}
            />
          )}
          <div id="reel-subtitle-overlay" className="reel-player__subtitle-slot" />
        </div>
      </div>
      <audio ref={audioRef} preload="auto" src={audioSrc} hidden aria-hidden="true" />
      {musicActive && musicFilename && (
        <audio
          ref={musicRef}
          preload="auto"
          src={backgroundMusicAudioUrl(projectId, musicFilename)}
          hidden
          aria-hidden="true"
        />
      )}
    </div>
  );
}
