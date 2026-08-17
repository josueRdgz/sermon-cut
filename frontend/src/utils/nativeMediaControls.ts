import type { VideoHTMLAttributes } from 'react';

/** Props for `<video controls>` in Tauri/WKWebView — avoids stuck native fullscreen/PiP. */
export const nativeVideoControlProps = {
  controls: true,
  playsInline: true,
  disablePictureInPicture: true,
  controlsList: 'nofullscreen noremoteplayback nodownload',
} satisfies Pick<
  VideoHTMLAttributes<HTMLVideoElement>,
  'controls' | 'playsInline' | 'disablePictureInPicture' | 'controlsList'
>;

/** Exit accidental native video fullscreen so Esc/right-click keep working in the shell. */
export function installNativeVideoFullscreenGuard(): () => void {
  function exitVideoFullscreen() {
    const active =
      document.fullscreenElement ??
      (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement;
    if (active instanceof HTMLVideoElement) {
      const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => undefined);
      } else if (doc.webkitExitFullscreen) {
        try {
          doc.webkitExitFullscreen();
        } catch {
          /* already exited */
        }
      }
    }
  }

  document.addEventListener('fullscreenchange', exitVideoFullscreen);
  document.addEventListener('webkitfullscreenchange', exitVideoFullscreen);
  return () => {
    document.removeEventListener('fullscreenchange', exitVideoFullscreen);
    document.removeEventListener('webkitfullscreenchange', exitVideoFullscreen);
  };
}
