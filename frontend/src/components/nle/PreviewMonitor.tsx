import type { Ref } from 'react';

import { backgroundMusicAudioUrl } from '../../api/backgroundMusic';
import { projectVideoUrl } from '../../api/projects';
import type { ReelOverlay } from '../../types/overlay';
import type { AspectRatio, FramingMode } from '../../types/reel';
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
  musicFilename: string | null;
  musicActive: boolean;
  onAssembledTime: (seconds: number) => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (overlayId: string) => void;
  onMoveOverlay?: (overlayId: string, x: number, y: number) => void;
  framingMode?: FramingMode | string | null;
  cropX?: number | null;
  cropY?: number | null;
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
  musicFilename,
  musicActive,
  onAssembledTime,
  selectedOverlayId = null,
  onSelectOverlay,
  onMoveOverlay,
  framingMode = 'center_crop',
  cropX = 0.5,
  cropY = 0.45,
}: PreviewMonitorProps) {
  const videoSrc = projectVideoUrl(projectId, mediaRevision);
  const videoFit = previewVideoFit(framingMode);
  const objectPosition = previewObjectPosition(cropX, cropY);
  const videoStyle = { objectFit: videoFit, objectPosition } as const;

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
        >
          <video
            ref={videoRef}
            className={`reel-player__video reel-player__video--${videoFit}`}
            style={videoStyle}
            controls={false}
            disablePictureInPicture
            playsInline
            preload="auto"
            src={videoSrc}
            hidden={previewMode === 'assembled' || activeProgramLane !== 0}
          >
            Tu navegador no soporta video HTML5.
          </video>
          <video
            ref={standbyVideoRef}
            className={`reel-player__video reel-player__video--${videoFit}`}
            style={videoStyle}
            controls={false}
            disablePictureInPicture
            playsInline
            muted
            preload="auto"
            src={videoSrc}
            hidden={previewMode === 'assembled' || activeProgramLane !== 1}
          />
          {assembledSrc && (
            <video
              ref={assembledVideoRef}
              className={`reel-player__video reel-player__video--${videoFit}`}
              style={videoStyle}
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
          {previewMode === 'logical' && (
            <OverlayPreviewLayer
              overlays={overlays}
              outputTime={outputTime}
              previewing={previewing}
              selectedOverlayId={selectedOverlayId}
              onSelectOverlay={onSelectOverlay}
              onMoveOverlay={onMoveOverlay}
            />
          )}
          <div id="reel-subtitle-overlay" className="reel-player__subtitle-slot" />
        </div>
      </div>
      <audio ref={audioRef} preload="auto" src={videoSrc} aria-hidden="true" />
      {musicActive && musicFilename && (
        <audio
          ref={musicRef}
          preload="auto"
          src={backgroundMusicAudioUrl(projectId, musicFilename)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
