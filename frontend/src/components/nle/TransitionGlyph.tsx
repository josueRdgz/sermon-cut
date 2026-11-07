import { useId } from 'react';

import type { TransitionType } from '../../types/reel';

interface TransitionGlyphProps {
  type: TransitionType | string;
  className?: string;
}

export function TransitionGlyph({ type, className }: TransitionGlyphProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 40 28"
      className={className}
      aria-hidden
      focusable="false"
    >
      <rect x="0.6" y="0.6" width="38.8" height="26.8" rx="4" fill="#111827" stroke="#334155" />
      {glyphBody(type, uid)}
    </svg>
  );
}

function glyphBody(type: string, uid: string) {
  switch (type) {
    case 'hard_cut':
      return (
        <>
          <rect x="3" y="5" width="16.5" height="18" rx="1.5" fill="#2dd4bf" />
          <rect x="20.5" y="5" width="16.5" height="18" rx="1.5" fill="#60a5fa" />
        </>
      );
    case 'short_crossfade':
    case 'fade':
      return (
        <>
          <rect x="3" y="5" width="34" height="18" rx="1.5" fill={`url(#fx-fade-${uid})`} />
          <defs>
            <linearGradient id={`fx-fade-${uid}`} x1="3" y1="14" x2="37" y2="14" gradientUnits="userSpaceOnUse">
              <stop stopColor="#2dd4bf" />
              <stop offset="1" stopColor="#60a5fa" />
            </linearGradient>
          </defs>
        </>
      );
    case 'dip_to_black':
      return (
        <>
          <rect x="3" y="5" width="11" height="18" rx="1.5" fill="#2dd4bf" />
          <rect x="14.5" y="5" width="11" height="18" fill="#020617" />
          <rect x="26" y="5" width="11" height="18" rx="1.5" fill="#60a5fa" />
        </>
      );
    case 'flash':
      return (
        <>
          <rect x="3" y="5" width="11" height="18" rx="1.5" fill="#2dd4bf" />
          <rect x="14.5" y="5" width="11" height="18" fill="#f8fafc" />
          <rect x="26" y="5" width="11" height="18" rx="1.5" fill="#60a5fa" />
        </>
      );
    case 'light_change':
      return (
        <>
          <rect x="3" y="5" width="16.5" height="18" rx="1.5" fill="#94a3b8" />
          <rect x="20.5" y="5" width="16.5" height="18" rx="1.5" fill="#cbd5e1" />
        </>
      );
    case 'dissolve':
      return (
        <>
          <rect x="3" y="5" width="34" height="18" rx="1.5" fill="#2dd4bf" />
          <circle cx="14" cy="10" r="1.6" fill="#60a5fa" />
          <circle cx="20" cy="14" r="1.8" fill="#60a5fa" />
          <circle cx="26" cy="11" r="1.4" fill="#60a5fa" />
          <circle cx="18" cy="19" r="1.5" fill="#60a5fa" />
          <circle cx="29" cy="18" r="1.7" fill="#60a5fa" />
          <circle cx="23" cy="8" r="1.2" fill="#60a5fa" />
        </>
      );
    case 'wipe_left':
      return wipe(12);
    case 'wipe_right':
      return wipe(22);
    case 'wipe_up':
      return (
        <>
          <rect x="3" y="5" width="34" height="18" rx="1.5" fill="#60a5fa" />
          <rect x="3" y="14" width="34" height="9" fill="#2dd4bf" />
        </>
      );
    case 'wipe_down':
      return (
        <>
          <rect x="3" y="5" width="34" height="18" rx="1.5" fill="#2dd4bf" />
          <rect x="3" y="5" width="34" height="9" fill="#60a5fa" />
        </>
      );
    case 'slide_left':
      return (
        <>
          <rect x="8" y="6" width="22" height="16" rx="1.5" fill="#2dd4bf" opacity="0.55" />
          <rect x="3" y="8" width="22" height="16" rx="1.5" fill="#60a5fa" />
        </>
      );
    case 'slide_right':
      return (
        <>
          <rect x="3" y="6" width="22" height="16" rx="1.5" fill="#2dd4bf" opacity="0.55" />
          <rect x="15" y="8" width="22" height="16" rx="1.5" fill="#60a5fa" />
        </>
      );
    case 'slide_up':
      return (
        <>
          <rect x="8" y="9" width="24" height="14" rx="1.5" fill="#2dd4bf" opacity="0.55" />
          <rect x="8" y="4" width="24" height="14" rx="1.5" fill="#60a5fa" />
        </>
      );
    case 'slide_down':
      return (
        <>
          <rect x="8" y="4" width="24" height="14" rx="1.5" fill="#2dd4bf" opacity="0.55" />
          <rect x="8" y="10" width="24" height="14" rx="1.5" fill="#60a5fa" />
        </>
      );
    case 'circle_open':
      return (
        <>
          <rect x="3" y="5" width="34" height="18" rx="1.5" fill="#2dd4bf" />
          <circle cx="20" cy="14" r="7" fill="#60a5fa" />
        </>
      );
    case 'circle_close':
      return (
        <>
          <rect x="3" y="5" width="34" height="18" rx="1.5" fill="#60a5fa" />
          <circle cx="20" cy="14" r="5" fill="#111827" stroke="#2dd4bf" strokeWidth="1.4" />
        </>
      );
    case 'pixelize':
      return (
        <>
          <rect x="3" y="5" width="8" height="9" fill="#2dd4bf" />
          <rect x="11" y="5" width="8" height="9" fill="#5eead4" />
          <rect x="19" y="5" width="8" height="9" fill="#60a5fa" />
          <rect x="27" y="5" width="10" height="9" fill="#93c5fd" />
          <rect x="3" y="14" width="8" height="9" fill="#14b8a6" />
          <rect x="11" y="14" width="8" height="9" fill="#38bdf8" />
          <rect x="19" y="14" width="8" height="9" fill="#3b82f6" />
          <rect x="27" y="14" width="10" height="9" fill="#2563eb" />
        </>
      );
    case 'radial':
      return (
        <>
          <rect x="3" y="5" width="34" height="18" rx="1.5" fill="#2dd4bf" />
          <circle cx="20" cy="14" r="9" fill="none" stroke="#60a5fa" strokeWidth="2" />
          <circle cx="20" cy="14" r="5" fill="none" stroke="#93c5fd" strokeWidth="1.6" />
          <circle cx="20" cy="14" r="2.2" fill="#60a5fa" />
        </>
      );
    case 'zoom_in':
      return (
        <>
          <rect x="6" y="7" width="28" height="14" rx="1.5" fill="#2dd4bf" opacity="0.45" />
          <rect x="12" y="9" width="16" height="10" rx="1.2" fill="#60a5fa" />
        </>
      );
    default:
      return (
        <>
          <rect x="3" y="5" width="16.5" height="18" rx="1.5" fill="#2dd4bf" />
          <rect x="20.5" y="5" width="16.5" height="18" rx="1.5" fill="#60a5fa" />
        </>
      );
  }
}

function wipe(splitX: number) {
  return (
    <>
      <rect x="3" y="5" width="34" height="18" rx="1.5" fill="#2dd4bf" />
      <rect x={splitX} y="5" width={37 - splitX} height="18" fill="#60a5fa" />
    </>
  );
}
