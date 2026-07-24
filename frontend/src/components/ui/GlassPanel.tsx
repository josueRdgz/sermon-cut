import type { HTMLAttributes } from 'react';

import styles from './GlassPanel.module.css';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds the subtle top-lit gradient used by the hero surface. */
  hero?: boolean;
}

export function GlassPanel({ hero, className, children, ...rest }: GlassPanelProps) {
  return (
    <div
      className={[styles.panel, hero ? styles.hero : '', className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
